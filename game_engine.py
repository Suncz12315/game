"""
松鼠大作战 - 核心引擎模块
包含：实体基类、物理系统、碰撞检测、关卡数据
"""

import pygame
import math
import random
from enum import Enum

# ─── 常量 ───────────────────────────────────────────────
SCREEN_W, SCREEN_H = 960, 640
TILE = 40                     # 地图网格大小
FPS = 60

# 物理参数
GRAVITY = 0.75
MAX_FALL = 14
PLAYER_SPEED = 5
PLAYER_JUMP = -15
ENEMY_SPEED = 2

# 颜色
COL_BG_TOP = (92, 140, 220)
COL_BG_BOT = (170, 210, 245)
COL_TILE = (139, 90, 43)
COL_TILE_TOP = (176, 124, 62)
COL_ACORN = (212, 175, 55)
COL_HEART = (220, 60, 60)


# ─── 方向枚举 ───────────────────────────────────────────
class Dir(Enum):
    LEFT = -1
    RIGHT = 1


# ─── 地图系统 ───────────────────────────────────────────
class TileMap:
    """基于字符矩阵的关卡地图"""

    # 字符映射:
    #   '#' = 砖块   '@' = 泥土平台   '=' = 草地顶面
    #   'A' = 橡果   'E' = 敌人出生点   'P' = 玩家出生点
    #   'L' = 移动平台(左)  'S' = 弹簧   ' ' = 空

    def __init__(self, rows, enemy_speed=ENEMY_SPEED):
        self.h = len(rows)
        self.w = max(len(r) for r in rows)
        # 关卡数据里各行的长度并不一致；补齐到相同宽度，
        # 否则按 w 遍历时 self.rows[ty][tx] 会越界崩溃。
        self.rows = [r.ljust(self.w) for r in rows]
        self.pixel_w = self.w * TILE
        self.enemy_speed = enemy_speed
        self.acorns = []
        self.enemies_spawns = []
        self.player_spawn = (TILE * 3, TILE * (self.h - 3))
        self.springs = []
        self._parse()

    def _parse(self):
        for y, row in enumerate(self.rows):
            for x, ch in enumerate(row):
                px, py_ = x * TILE, y * TILE
                if ch == 'A':
                    self.acorns.append(Acorn(px, py_))
                elif ch == 'E':
                    self.enemies_spawns.append((px, py_))
                elif ch == 'P':
                    self.player_spawn = (px, py_)
                elif ch == 'S':
                    self.springs.append(Spring(px, py_))

    def is_solid(self, tx, ty):
        if tx < 0 or tx >= self.w or ty < 0 or ty >= self.h:
            return True
        return self.rows[ty][tx] in ('#', '@', '=')

    def tile_type(self, tx, ty):
        if tx < 0 or tx >= self.w or ty < 0 or ty >= self.h:
            return ' '
        return self.rows[ty][tx]

    def draw(self, surf, cam_x, cam_y):
        start_col = max(0, int(cam_x // TILE))
        end_col = min(self.w, int((cam_x + SCREEN_W) // TILE) + 1)
        start_row = max(0, int(cam_y // TILE))
        end_row = min(self.h, int((cam_y + SCREEN_H) // TILE) + 1)

        for ty in range(start_row, end_row):
            for tx in range(start_col, end_col):
                ch = self.rows[ty][tx]
                px = tx * TILE - cam_x
                py_ = ty * TILE - cam_y
                if ch == '#':
                    self._draw_brick(surf, px, py_, dark=True)
                elif ch == '@':
                    self._draw_brick(surf, px, py_, dark=False)
                elif ch == '=':
                    self._draw_grass(surf, px, py_)

    @staticmethod
    def _draw_brick(surf, x, y, dark):
        c = COL_TILE if dark else (168, 118, 62)
        pygame.draw.rect(surf, c, (x, y, TILE, TILE))
        pygame.draw.rect(surf, tuple(max(0, v - 30) for v in c), (x, y, TILE, 3))
        pygame.draw.line(surf, tuple(max(0, v - 45) for v in c),
                         (x, y + TILE // 2), (x + TILE, y + TILE // 2), 2)
        pygame.draw.line(surf, tuple(max(0, v - 45) for v in c),
                         (x + TILE // 2, y), (x + TILE // 2, y + TILE), 2)

    @staticmethod
    def _draw_grass(surf, x, y):
        pygame.draw.rect(surf, COL_TILE, (x, y, TILE, TILE))
        for i in range(4):
            gx = x + i * 10
            pygame.draw.polygon(surf, (80, 180, 60), [
                (gx, y), (gx + 5, y - 12), (gx + 10, y)
            ])
            pygame.draw.polygon(surf, (60, 150, 45), [
                (gx + 5, y), (gx + 10, y - 8), (gx + 15, y)
            ])


# ─── 实体基类 ───────────────────────────────────────────
class Entity:
    def __init__(self, x, y, w, h):
        self.x = float(x)
        self.y = float(y)
        self.w = w
        self.h = h
        self.vx = 0.0
        self.vy = 0.0
        self.on_ground = False
        self.dead = False
        self._old_x = x
        self._old_y = y

    @property
    def rect(self):
        return pygame.Rect(int(self.x), int(self.y), self.w, self.h)

    def move_and_collide(self, tilemap):
        """带碰撞的位移"""
        self._old_x = self.x
        self._old_y = self.y

        # Y 轴：先处理垂直方向。实体出生/落地时可能嵌进地面几个像素，
        # 若先做水平移动，这种垂直重叠会被误判成撞墙。
        self.on_ground = False
        self.y += self.vy
        for tx in self._tile_range_x(tilemap):
            for ty in self._tile_range_y(tilemap):
                if tilemap.is_solid(tx, ty):
                    r = pygame.Rect(tx * TILE, ty * TILE, TILE, TILE)
                    if self.rect.colliderect(r):
                        if self.vy > 0:
                            self.y = r.top - self.h
                            self.on_ground = True
                        elif self.vy < 0:
                            self.y = r.bottom
                        self.vy = 0
                        break

        # X 轴
        old_rect = self.rect
        self.x += self.vx
        for tx in self._tile_range_x(tilemap):
            for ty in self._tile_range_y(tilemap):
                if tilemap.is_solid(tx, ty):
                    r = pygame.Rect(tx * TILE, ty * TILE, TILE, TILE)
                    if self.rect.colliderect(r):
                        # 移动前就已经和该格重叠时，不当作水平碰撞处理
                        if old_rect.colliderect(r):
                            continue
                        if self.vx > 0:
                            self.x = r.left - self.w
                        elif self.vx < 0:
                            self.x = r.right
                        self.vx = 0
                        break

        # 站立检测：贴地时矩形与地面刚好接触，colliderect 不算重叠。
        # 若只看本帧碰撞，on_ground 会逐帧闪烁，导致点按跳跃偶尔失灵。
        if not self.on_ground and self.vy >= 0:
            if self._rect_hits_solid(self.rect.move(0, 1), tilemap):
                self.on_ground = True

    @staticmethod
    def _rect_hits_solid(rect, tilemap):
        """矩形是否与任意实心格子相交"""
        lx = max(0, rect.left // TILE)
        rx = min(tilemap.w - 1, (rect.right - 1) // TILE)
        ly = max(0, rect.top // TILE)
        ry = min(tilemap.h - 1, (rect.bottom - 1) // TILE)
        if lx > rx or ly > ry:
            return False
        for tx in range(lx, rx + 1):
            for ty in range(ly, ry + 1):
                if tilemap.is_solid(tx, ty):
                    r = pygame.Rect(tx * TILE, ty * TILE, TILE, TILE)
                    if rect.colliderect(r):
                        return True
        return False

    def _tile_range_x(self, tm):
        lx = max(0, int(self.x // TILE))
        rx = min(tm.w - 1, int((self.x + self.w - 1) // TILE))
        return range(lx, rx + 1) if lx <= rx else range(0)

    def _tile_range_y(self, tm):
        ly = max(0, int(self.y // TILE))
        ry = min(tm.h - 1, int((self.y + self.h - 1) // TILE))
        return range(ly, ry + 1) if ly <= ry else range(0)

    def apply_gravity(self):
        self.vy = min(self.vy + GRAVITY, MAX_FALL)


# ─── 玩家：松鼠 🐿️ ────────────────────────────────────────
class Player(Entity):
    def __init__(self, x, y):
        super().__init__(x, y, 34, 38)
        self.facing = Dir.RIGHT
        self.lives = 3
        self.invincible = 0          # 无敌帧
        self.anim_timer = 0
        self.run_frame = 0
        self.score = 0
        self.holding_item = None     # 举起的箱子/敌人
        self.throw_cooldown = 0

    def update(self, keys, tilemap, enemies):
        # 水平移动
        moving = False
        if keys[pygame.K_LEFT] or keys[pygame.K_a]:
            self.vx = -PLAYER_SPEED
            self.facing = Dir.LEFT
            moving = True
        elif keys[pygame.K_RIGHT] or keys[pygame.K_d]:
            self.vx = PLAYER_SPEED
            self.facing = Dir.RIGHT
            moving = True
        else:
            self.vx *= 0.6

        # 跳跃
        if (keys[pygame.K_SPACE] or keys[pygame.K_UP] or keys[pygame.K_w]) and self.on_ground:
            self.vy = PLAYER_JUMP
            self.on_ground = False

        # 投掷 / 举起
        if self.throw_cooldown > 0:
            self.throw_cooldown -= 1

        self.apply_gravity()
        self.move_and_collide(tilemap)

        # 掉出地图：扣一条命并回到出生点，否则会在画面外反复死亡
        if self.y > tilemap.h * TILE + 100:
            self.die()
            if not self.dead:
                self.x, self.y = tilemap.player_spawn
                self.vx = 0.0
                self.vy = 0.0
                self.on_ground = False

        # 无敌帧递减
        if self.invincible > 0:
            self.invincible -= 1

        # 动画帧
        if moving and self.on_ground:
            self.anim_timer += 1
            if self.anim_timer >= 6:
                self.anim_timer = 0
                self.run_frame = (self.run_frame + 1) % 4

    def die(self):
        if self.invincible > 0:
            return
        self.lives -= 1
        self.invincible = 90
        self.vy = PLAYER_JUMP * 0.7
        if self.lives < 0:
            self.dead = True

    def throw(self, enemies):
        """投掷举起的物品"""
        if self.holding_item and self.throw_cooldown == 0:
            item = self.holding_item
            item.vx = 8 * self.facing.value
            item.vy = -5
            item.thrown = True
            enemies.append(item)
            self.holding_item = None
            self.throw_cooldown = 20

    def draw(self, surf, cam_x, cam_y):
        if self.invincible > 0 and (self.invincible // 4) % 2:
            return  # 闪烁
        x = int(self.x - cam_x)
        y = int(self.y - cam_y)
        self._draw_squirrel(surf, x, y)

    def _draw_squirrel(self, surf, x, y):
        body_c = (210, 150, 80)
        belly_c = (245, 215, 160)
        flick = self.run_frame * 3 if self.on_ground and abs(self.vx) > 0.5 else 0

        # 尾巴（大！）
        tail_off = 6 + flick
        if self.facing == Dir.RIGHT:
            pygame.draw.ellipse(surf, body_c, (x + 22, y - tail_off + 4, 22, 26))
            pygame.draw.ellipse(surf, belly_c, (x + 26, y - tail_off + 8, 14, 16))
        else:
            pygame.draw.ellipse(surf, body_c, (x - 10, y - tail_off + 4, 22, 26))
            pygame.draw.ellipse(surf, belly_c, (x - 6, y - tail_off + 8, 14, 16))

        # 身体
        pygame.draw.ellipse(surf, body_c, (x + 4, y + 12, 26, 22))
        pygame.draw.ellipse(surf, belly_c, (x + 8, y + 18, 18, 12))

        # 头
        pygame.draw.ellipse(surf, body_c, (x + 6, y, 22, 20))

        # 耳朵
        pygame.draw.ellipse(surf, body_c, (x + 6, y - 8, 8, 12))
        pygame.draw.ellipse(surf, body_c, (x + 18, y - 8, 8, 12))
        pygame.draw.ellipse(surf, (240, 200, 180), (x + 8, y - 6, 4, 7))
        pygame.draw.ellipse(surf, (240, 200, 180), (x + 20, y - 6, 4, 7))

        # 眼睛
        eyex = x + 20 if self.facing == Dir.RIGHT else x + 12
        pygame.draw.circle(surf, (40, 30, 20), (eyex, y + 8), 3)
        pygame.draw.circle(surf, (255, 255, 255), (eyex + 1, y + 7), 1)

        # 鼻子
        nosex = x + 26 if self.facing == Dir.RIGHT else x + 6
        pygame.draw.circle(surf, (200, 80, 60), (nosex, y + 13), 2)


# ─── 橡果 🌰 ─────────────────────────────────────────────
class Acorn:
    def __init__(self, x, y):
        self.x = x
        self.y = y
        self.collected = False
        self.bob = random.random() * math.pi * 2
        self.rect = pygame.Rect(x, y, TILE, TILE)

    def draw(self, surf, cam_x, cam_y):
        if self.collected:
            return
        bx = self.x - cam_x
        by = self.y - cam_y + int(math.sin(self.bob) * 3)
        self.bob += 0.06

        # 橡果帽
        pygame.draw.ellipse(surf, (120, 70, 30), (bx + 8, by + 4, 20, 12))
        pygame.draw.ellipse(surf, (150, 95, 45), (bx + 10, by + 6, 16, 8))
        # 果体
        pygame.draw.ellipse(surf, COL_ACORN, (bx + 6, by + 12, 24, 20))
        pygame.draw.ellipse(surf, (230, 195, 80), (bx + 10, by + 16, 16, 10))
        # 光泽
        pygame.draw.ellipse(surf, (240, 220, 150), (bx + 10, by + 14, 8, 6))


# ─── 弹簧 🔴 ─────────────────────────────────────────────
class Spring:
    def __init__(self, x, y):
        self.x = x
        self.y = y
        self.rect = pygame.Rect(x, y, TILE, TILE // 2)
        self.anim = 0

    def activate(self):
        self.anim = 8

    def update(self):
        if self.anim > 0:
            self.anim -= 1

    def draw(self, surf, cam_x, cam_y):
        bx = self.x - cam_x
        by = self.y - cam_y
        h = 8 + (self.anim * 3)
        pygame.draw.rect(surf, (200, 50, 50), (bx + 4, by + TILE // 2 - h, TILE - 8, h))
        pygame.draw.rect(surf, (250, 200, 50), (bx + 2, by + TILE // 2 - h - 4, TILE - 4, 6))


# ─── 敌人 ───────────────────────────────────────────────
class Enemy(Entity):
    def __init__(self, x, y, etype='walker', speed=ENEMY_SPEED):
        super().__init__(x, y, 32, 34)
        self.etype = etype
        self.speed = speed
        self.vx = speed if random.random() < 0.5 else -speed
        self.patrol_start = x
        self.patrol_range = 200
        self.thrown = False
        self.anim_t = random.random() * 6

    def update(self, tilemap):
        if self.thrown:
            self.apply_gravity()
            self.move_and_collide(tilemap)
            if self.on_ground:
                self.thrown = False
                self.vx = self.speed if self.vx > 0 else -self.speed
            return

        # 记住朝向：move_and_collide 撞墙时会把 vx 归零
        direction = 1 if self.vx >= 0 else -1
        self.vx = self.speed * direction
        self.apply_gravity()
        self.move_and_collide(tilemap)

        # 撞墙或超出巡逻范围时掉头（原来 vx 被归零后永远不会再翻转）
        if self.vx == 0 or abs(self.x - self.patrol_start) > self.patrol_range:
            self.vx = -self.speed * direction

        self.anim_t += 0.1

    def draw(self, surf, cam_x, cam_y):
        x = int(self.x - cam_x)
        y = int(self.y - cam_y)
        bob = int(math.sin(self.anim_t) * 2)

        if self.etype == 'walker':
            # 蓝色史莱姆
            c = (80, 140, 220)
            pygame.draw.ellipse(surf, c, (x + 2, y + bob + 8, 28, 26))
            pygame.draw.ellipse(surf, (120, 175, 240), (x + 6, y + bob + 12, 20, 14))
            pygame.draw.ellipse(surf, (255, 255, 255), (x + 6, y + bob + 10, 8, 8))
            pygame.draw.ellipse(surf, (255, 255, 255), (x + 18, y + bob + 10, 8, 8))
            pygame.draw.ellipse(surf, (30, 30, 30), (x + 8, y + bob + 12, 4, 4))
            pygame.draw.ellipse(surf, (30, 30, 30), (x + 20, y + bob + 12, 4, 4))
        else:
            # 红色恶魔
            c = (220, 60, 60)
            pygame.draw.ellipse(surf, c, (x + 2, y + bob + 8, 28, 26))
            pygame.draw.polygon(surf, c, [(x + 6, y + bob + 8), (x + 2, y + bob), (x + 10, y + bob + 6)])
            pygame.draw.polygon(surf, c, [(x + 26, y + bob + 8), (x + 30, y + bob), (x + 22, y + bob + 6)])
            pygame.draw.ellipse(surf, (30, 30, 30), (x + 7, y + bob + 14, 5, 5))
            pygame.draw.ellipse(surf, (30, 30, 30), (x + 20, y + bob + 14, 5, 5))


# ─── 关卡定义 ───────────────────────────────────────────
def load_level(level_num):
    """根据关卡号生成地图数据"""
    if level_num == 1:
        return _level1()
    elif level_num == 2:
        return _level2()
    else:
        return _level3()


# 难度曲线：
#   第 1 关 —— 平台宽（4 格）、落差 2 格、只有 2 个慢敌人，适合上手；
#   第 2 关 —— 平台 3 格宽、出现 3 格落差、4 个敌人；
#   第 3 关 —— 连续高台与 3 格落差、平台更窄、6 个更快敌人。
# 所有橡果都放在平台或地面上，保证可以走到/跳到。
LEVEL_ENEMY_SPEED = {1: 1.4, 2: 1.8, 3: 2.2}


def _level1():
    rows = [
        "                                  ",
        "                                  ",
        "                                  ",
        "                                  ",
        "                                  ",
        "                                  ",
        "                                  ",
        "                  A               ",
        "                 ====             ",
        "            A           A         ",
        "           ====        ====       ",
        "      A                           ",
        "     ====                         ",
        "  P A    S     AE           A E   ",
        "==================================",
        "##################################",
    ]
    return TileMap(rows, enemy_speed=LEVEL_ENEMY_SPEED[1])


def _level2():
    rows = [
        "                                          ",
        "                                          ",
        "                                          ",
        "                                          ",
        "                                          ",
        "                                          ",
        "                                          ",
        "                A                         ",
        "               ===             A          ",
        "           A         A        ===         ",
        "          ===       ===             A     ",
        "      A                   A        ===    ",
        "     ===                 ===              ",
        "  P A    S    E    E  A      E        E A ",
        "==========================================",
        "##########################################",
    ]
    return TileMap(rows, enemy_speed=LEVEL_ENEMY_SPEED[2])


def _level3():
    rows = [
        "                                                    ",
        "                                                    ",
        "                                                    ",
        "                                                    ",
        "                                   A                ",
        "                         A        ===               ",
        "                A       ===                         ",
        "               ===            A         A           ",
        "           A        A        ===       ===          ",
        "          ===       ==                              ",
        "                                             A      ",
        "      A                                     ===     ",
        "     ===                                            ",
        "  P A    E   S   A E        E   SA    E    E  E  A  ",
        "====================================================",
        "####################################################",
    ]
    return TileMap(rows, enemy_speed=LEVEL_ENEMY_SPEED[3])
