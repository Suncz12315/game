"""
松鼠大作战 - 主程序 / GUI
横版平台动作游戏：控制松鼠收集橡果、踩敌人、闯关卡
"""

import pygame
import sys
import math
import random

from game_engine import (
    SCREEN_W, SCREEN_H, TILE, FPS,
    COL_BG_TOP, COL_BG_BOT, COL_HEART,
    Player, Enemy, TileMap, load_level,
)

# ─── 初始化 pygame ──────────────────────────────────────
pygame.init()
pygame.display.set_caption("🐿️ 松鼠大作战")
pygame.display.set_icon(pygame.Surface((32, 32)))
_screen = pygame.display.set_mode((SCREEN_W, SCREEN_H))
clock = pygame.time.Clock()

# ─── 字体 ───────────────────────────────────────────────
# SysFont 找不到字体时不会抛异常，而是静默退回不含中文字形的默认字体，
# 所以必须先用 match_font 探测系统中实际存在的中文字体。
FONT_CANDIDATES = (
    "microsoftyahei",    # Windows
    "pingfangsc",        # macOS
    "hiraginosansgb",    # macOS
    "notosanscjksc",     # Linux
    "wenquanyimicrohei", # Linux
    "simhei",            # Windows / Linux
    "arialunicode",      # 兜底
)


def _pick_font():
    for name in FONT_CANDIDATES:
        if pygame.font.match_font(name):
            return name
    return None


FONT_NAME = _pick_font()
FONT_BIG = pygame.font.SysFont(FONT_NAME, 48, bold=True)
FONT_MID = pygame.font.SysFont(FONT_NAME, 28, bold=True)
FONT_SM = pygame.font.SysFont(FONT_NAME, 20)
FONT_TINY = pygame.font.SysFont(FONT_NAME, 16)

# ─── 粒子系统 ───────────────────────────────────────────
class Particle:
    def __init__(self, x, y, color, speed=4, size_range=(3, 7), life=30):
        self.x = x
        self.y = y
        self.color = color
        self.size = random.randint(*size_range)
        angle = random.uniform(0, math.pi * 2)
        spd = random.uniform(1, speed)
        self.vx = math.cos(angle) * spd
        self.vy = math.sin(angle) * spd - 2
        self.life = life
        self.max_life = life

    def update(self):
        self.x += self.vx
        self.y += self.vy
        self.vy += 0.2
        self.life -= 1

    def draw(self, surf, cam_x, cam_y):
        alpha = max(0, self.life / self.max_life)
        size = max(1, int(self.size * alpha))
        col = tuple(int(c * alpha + 30 * (1 - alpha)) for c in self.color)
        pygame.draw.circle(surf, col, (int(self.x - cam_x), int(self.y - cam_y)), size)


class FloatingText:
    def __init__(self, x, y, text, color=(255, 240, 100)):
        self.x = x
        self.y = y
        self.text = text
        self.color = color
        self.life = 45
        self.surface = FONT_SM.render(text, True, color)
        self.shadow = FONT_SM.render(text, True, (0, 0, 0))

    def update(self):
        self.y -= 1.2
        self.life -= 1

    def draw(self, surf, cam_x, cam_y):
        alpha = min(1.0, self.life / 15)
        x = int(self.x - cam_x)
        y = int(self.y - cam_y)
        surf.blit(self.shadow, (x + 1, y + 1))
        surf.blit(self.surface, (x, y))


# ─── 背景装饰 ───────────────────────────────────────────
class Cloud:
    def __init__(self):
        self.x = random.randint(-200, SCREEN_W + 200)
        self.y = random.randint(30, 200)
        self.speed = random.uniform(0.2, 0.6)
        self.scale = random.uniform(0.6, 1.2)
        self.puffs = [(random.randint(-30, 30), random.randint(-15, 10),
                       random.randint(25, 50)) for _ in range(4)]

    def update(self):
        self.x += self.speed
        if self.x > SCREEN_W + 150:
            self.x = -150
            self.y = random.randint(30, 200)

    def draw(self, surf):
        for dx, dy, r in self.puffs:
            pygame.draw.circle(surf, (255, 255, 255, 180),
                               (int(self.x + dx * self.scale),
                                int(self.y + dy * self.scale)),
                               int(r * self.scale))


class Tree:
    def __init__(self, x):
        self.x = x
        self.h = random.randint(80, 160)
        self.canopy_colors = [
            (random.randint(40, 80), random.randint(140, 200), random.randint(50, 90))
            for _ in range(3)
        ]

    def draw(self, surf, cam_x):
        sx = self.x - cam_x
        if sx < -80 or sx > SCREEN_W + 80:
            return
        # 树干
        pygame.draw.rect(surf, (120, 80, 40), (sx - 6, SCREEN_H - 120 - self.h, 12, self.h))
        # 树冠
        for i, (r, g, b) in enumerate(self.canopy_colors):
            oy = -self.h + i * 20
            pygame.draw.circle(surf, (r, g, b), (sx, SCREEN_H - 120 + oy), 35 - i * 5)


# ─── 游戏状态 ───────────────────────────────────────────
class GameState:
    MENU = 0
    PLAYING = 1
    PAUSED = 2
    LEVEL_CLEAR = 3
    GAME_OVER = 4
    VICTORY = 5


# ─── 主游戏类 ───────────────────────────────────────────
class SquirrelGame:
    def __init__(self):
        self.state = GameState.MENU
        self.level = 1
        self.max_level = 3
        self.score = 0
        self._build_level()

        self.clouds = [Cloud() for _ in range(6)]
        self.trees = [Tree(random.randint(0, 2000)) for _ in range(12)]
        self.particles = []
        self.float_texts = []
        self.cam_x = 0
        self.cam_y = 0
        self.bg_offset = 0

        self.clear_timer = 0
        self.menu_pulse = 0

    def _build_level(self):
        self.tilemap = load_level(self.level)
        self.player = Player(*self.tilemap.player_spawn)
        self.enemies = [Enemy(x, y, speed=self.tilemap.enemy_speed)
                        for x, y in self.tilemap.enemies_spawns]
        self.acorns = [a for a in self.tilemap.acorns]

    # ─── 输入处理 ────────────────────────────────────────
    def handle_event(self, event):
        if event.type == pygame.KEYDOWN:
            if self.state == GameState.MENU:
                if event.key == pygame.K_RETURN:
                    self._start_game()
            elif self.state == GameState.PLAYING:
                if event.key == pygame.K_ESCAPE:
                    self.state = GameState.PAUSED
                elif event.key == pygame.K_f:
                    # 举起 / 投掷
                    self._try_pickup_or_throw()
            elif self.state == GameState.PAUSED:
                if event.key == pygame.K_ESCAPE:
                    self.state = GameState.PLAYING
            elif self.state == GameState.LEVEL_CLEAR:
                if event.key == pygame.K_RETURN and self.clear_timer <= 0:
                    self._next_level()
            elif self.state == GameState.GAME_OVER:
                if event.key == pygame.K_RETURN:
                    self._start_game()
            elif self.state == GameState.VICTORY:
                if event.key == pygame.K_RETURN:
                    self._start_game()

    def _try_pickup_or_throw(self):
        """举起附近的敌人或投掷"""
        if self.player.holding_item:
            self.player.throw(self.enemies)
            return
        # 尝试拾取附近敌人
        pr = self.player.rect
        for e in self.enemies[:]:
            if e.rect.colliderect(pr.inflate(50, 30)):
                e.vx = 0.0
                e.vy = 0.0
                e.thrown = False
                self.player.holding_item = e
                self.enemies.remove(e)
                self._spawn_particles(e.x + 16, e.y + 17, (200, 200, 200), 8)
                break

    def _update_held_item(self):
        """让举起的敌人跟随玩家头顶（原来会停在拾取位置）"""
        item = self.player.holding_item
        if item is None:
            return
        item.vx = 0.0
        item.vy = 0.0
        item.thrown = False
        item.x = self.player.x + (self.player.w - item.w) / 2
        item.y = self.player.y - item.h - 2

    # ─── 更新逻辑 ────────────────────────────────────────
    def update(self):
        if self.state == GameState.MENU:
            self.menu_pulse += 0.04
            for c in self.clouds:
                c.update()
            return

        if self.state == GameState.PAUSED:
            return

        if self.state == GameState.LEVEL_CLEAR:
            self.clear_timer -= 1
            for p in self.particles:
                p.update()
            return

        if self.state == GameState.PLAYING:
            keys = pygame.key.get_pressed()

            # 更新玩家
            self.player.update(keys, self.tilemap, self.enemies)
            self._update_held_item()

            # 更新弹簧
            for spring in self.tilemap.springs:
                spring.update()
                if self.player.rect.colliderect(spring.rect) and self.player.vy >= 0:
                    self.player.vy = -22
                    spring.activate()
                    self._spawn_particles(spring.x + 20, spring.y, (255, 200, 50), 6)

            # 更新敌人
            for e in self.enemies[:]:
                # 可能已被前面投掷中的敌人消灭，跳过快照里的残留引用
                if e not in self.enemies:
                    continue
                e.update(self.tilemap)
                # 投掷碰撞检测
                if e.thrown:
                    for other in self.enemies[:]:
                        if other is e or other not in self.enemies:
                            continue
                        if other.rect.colliderect(e.rect):
                            self.enemies.remove(other)
                            self.score += 200
                            self._spawn_particles(other.x + 16, other.y + 17, (255, 100, 50), 12)
                            self.float_texts.append(
                                FloatingText(other.x, other.y, "200", (255, 150, 50)))
                # 与玩家碰撞（自己投出的敌人飞行途中不会伤到自己）
                if not e.thrown and e.rect.colliderect(self.player.rect):
                    if self.player.vy > 0 and self.player.rect.bottom - e.rect.top < 20:
                        # 踩敌人
                        self.enemies.remove(e)
                        self.player.vy = -12
                        self.score += 100
                        self._spawn_particles(e.x + 16, e.y + 17, (255, 200, 50), 15)
                        self.float_texts.append(
                            FloatingText(e.x, e.y, "100", (255, 220, 80)))
                    else:
                        self.player.die()

            # 橡果收集
            for acorn in self.acorns:
                if not acorn.collected and acorn.rect.colliderect(self.player.rect):
                    acorn.collected = True
                    self.player.score += 50
                    self.score += 50
                    self._spawn_particles(acorn.x + 20, acorn.y + 20, (212, 175, 55), 10)
                    self.float_texts.append(
                        FloatingText(acorn.x, acorn.y, "50", (212, 175, 55)))

            # 检查关卡通关
            if all(a.collected for a in self.acorns):
                self.state = GameState.LEVEL_CLEAR
                self.clear_timer = 90
                self.score += self.player.lives * 500
                if self.level >= self.max_level:
                    self.state = GameState.VICTORY

            # 检查死亡
            if self.player.dead:
                self.state = GameState.GAME_OVER

            # 摄像机跟随
            target_x = self.player.x + self.player.w // 2 - SCREEN_W // 2
            target_y = self.player.y + self.player.h // 2 - SCREEN_H // 2
            target_x = max(0, min(target_x, self.tilemap.pixel_w - SCREEN_W))
            target_y = max(0, min(target_y, self.tilemap.h * TILE - SCREEN_H))
            self.cam_x += (target_x - self.cam_x) * 0.1
            self.cam_y += (target_y - self.cam_y) * 0.1
            self.bg_offset += 0.3

        # 更新粒子 / 漂浮文字
        for p in self.particles[:]:
            p.update()
            if p.life <= 0:
                self.particles.remove(p)
        for ft in self.float_texts[:]:
            ft.update()
            if ft.life <= 0:
                self.float_texts.remove(ft)
        for c in self.clouds:
            c.update()

    # ─── 绘制 ────────────────────────────────────────────
    def draw(self, surf):
        if self.state == GameState.MENU:
            self._draw_menu(surf)
            return

        # 背景渐变
        self._draw_background(surf)

        # 远景树
        for t in self.trees:
            t.draw(surf, self.cam_x * 0.3)

        # 地图
        self.tilemap.draw(surf, self.cam_x, self.cam_y)

        # 弹簧
        for s in self.tilemap.springs:
            s.draw(surf, self.cam_x, self.cam_y)

        # 橡果
        for a in self.acorns:
            a.draw(surf, self.cam_x, self.cam_y)

        # 敌人
        for e in self.enemies:
            e.draw(surf, self.cam_x, self.cam_y)

        # 举起物品
        if self.player.holding_item:
            self.player.holding_item.draw(surf, self.cam_x, self.cam_y)

        # 粒子
        for p in self.particles:
            p.draw(surf, self.cam_x, self.cam_y)

        # 玩家
        self.player.draw(surf, self.cam_x, self.cam_y)

        # 漂浮文字
        for ft in self.float_texts:
            ft.draw(surf, self.cam_x, self.cam_y)

        # HUD
        self._draw_hud(surf)

        # 覆盖层
        if self.state == GameState.PAUSED:
            self._draw_overlay(surf, "暂停", "游戏已暂停", FONT_BIG, "按 ESC 继续")
        elif self.state == GameState.LEVEL_CLEAR:
            self._draw_overlay(surf, "关卡完成!", f"得分 +{self.player.lives * 500}",
                               FONT_BIG, "按回车键进入下一关")
        elif self.state == GameState.GAME_OVER:
            self._draw_overlay(surf, "游戏结束", f"最终得分: {self.score}",
                               FONT_BIG, "按回车键重新开始")
        elif self.state == GameState.VICTORY:
            self._draw_overlay(surf, "通关胜利!", f"最终得分: {self.score}",
                               FONT_BIG, "按回车键重新开始")

    # ─── 绘制子函数 ──────────────────────────────────────
    def _draw_background(self, surf):
        for y in range(SCREEN_H):
            ratio = y / SCREEN_H
            r = int(COL_BG_TOP[0] * (1 - ratio) + Col(COL_BG_BOT)[0] * ratio)
            g = int(Col(COL_BG_TOP)[1] * (1 - ratio) + Col(COL_BG_BOT)[1] * ratio)
            b = int(Col(COL_BG_TOP)[2] * (1 - ratio) + Col(COL_BG_BOT)[2] * ratio)
            pygame.draw.line(surf, (r, g, b), (0, y), (SCREEN_W, y))

        for c in self.clouds:
            c.draw(surf)

    def _draw_hud(self, surf):
        # 顶部面板
        panel = pygame.Surface((SCREEN_W, 48), pygame.SRCALPHA)
        panel.fill((0, 0, 0, 120))
        surf.blit(panel, (0, 0))

        # 分数
        score_txt = FONT_MID.render(f"得分: {self.score}", True, (255, 240, 150))
        surf.blit(score_txt, (16, 10))

        # 关卡（按实际宽度居中，避免和右侧橡果计数重叠）
        lvl_txt = FONT_MID.render(f"关卡 {self.level}-{self.max_level}", True, (200, 240, 255))
        surf.blit(lvl_txt, (SCREEN_W // 2 - lvl_txt.get_width() // 2 - 70, 10))

        # 生命
        for i in range(max(0, self.player.lives)):
            self._draw_heart(surf, SCREEN_W - 40 - i * 36, 12)

        # 橡果计数
        collected = sum(1 for a in self.acorns if a.collected)
        total = len(self.acorns)
        acorn_txt = FONT_MID.render(f"橡果 {collected}/{total}", True, (212, 175, 55))
        surf.blit(acorn_txt, (SCREEN_W // 2 + 90, 10))

    @staticmethod
    def _draw_heart(surf, x, y):
        pygame.draw.polygon(surf, COL_HEART, [
            (x + 10, y + 6), (x + 20, y), (x + 10, y + 14),
            (x, y), (x + 10, y + 6)
        ])
        pygame.draw.circle(surf, COL_HEART, (x + 5, y + 3), 5)
        pygame.draw.circle(surf, COL_HEART, (x + 15, y + 3), 5)

    def _draw_menu(self, surf):
        # 背景
        for y in range(SCREEN_H):
            ratio = y / SCREEN_H
            r = int(COL_BG_TOP[0] * (1 - ratio) + Col(COL_BG_BOT)[0] * ratio)
            g = int(Col(COL_BG_TOP)[1] * (1 - ratio) + Col(COL_BG_BOT)[1] * ratio)
            b = int(Col(COL_BG_TOP)[2] * (1 - ratio) + Col(COL_BG_BOT)[2] * ratio)
            pygame.draw.line(surf, (r, g, b), (0, y), (SCREEN_W, y))

        for c in self.clouds:
            c.draw(surf)

        # 标题
        title = FONT_BIG.render("松鼠大作战", True, (255, 240, 150))
        shadow = FONT_BIG.render("松鼠大作战", True, (60, 40, 10))
        bx = SCREEN_W // 2 - title.get_width() // 2
        by = 120 + int(math.sin(self.menu_pulse) * 8)
        surf.blit(shadow, (bx + 3, by + 3))
        surf.blit(title, (bx, by))

        subtitle = FONT_MID.render("Squirrel Quest", True, (200, 230, 255))
        sx = SCREEN_W // 2 - subtitle.get_width() // 2
        surf.blit(subtitle, (sx, by + 65))

        # 大松鼠
        self._draw_menu_squirrel(surf, SCREEN_W // 2 - 40, 250)

        # 操作说明
        tips = [
            "操作说明：",
            "← → / A D    移动",
            "空格 / ↑ / W  跳跃",
            "F           举起 / 投掷敌人",
            "ESC           暂停",
        ]
        y = 380
        for i, t in enumerate(tips):
            col = (255, 240, 150) if i == 0 else (220, 220, 220)
            txt = FONT_SM.render(t, True, col)
            surf.blit(txt, (SCREEN_W // 2 - txt.get_width() // 2, y))
            y += 30

        # 开始提示
        alpha = int(180 + 75 * math.sin(self.menu_pulse * 2))
        start = FONT_MID.render("按 回车键 开始游戏", True,
                                (min(255, alpha + 50), 255, min(255, alpha + 50)))
        surf.blit(start, (SCREEN_W // 2 - start.get_width() // 2, 540))

        # 页脚
        foot = FONT_TINY.render("共 3 个关卡  ·  收集所有橡果即可通关", True, (180, 180, 180))
        surf.blit(foot, (SCREEN_W // 2 - foot.get_width() // 2, 600))

    def _draw_menu_squirrel(self, surf, x, y):
        bounce = int(math.sin(self.menu_pulse * 1.5) * 5)
        body_c = (210, 150, 80)
        belly_c = (245, 215, 160)

        # 尾巴
        pygame.draw.ellipse(surf, body_c, (x + 45, y + bounce, 45, 50))
        pygame.draw.ellipse(surf, belly_c, (x + 55, y + bounce + 10, 28, 30))
        # 身体
        pygame.draw.ellipse(surf, body_c, (x + 15, y + 30 + bounce, 50, 42))
        pygame.draw.ellipse(surf, belly_c, (x + 25, y + 42 + bounce, 32, 22))
        # 头
        pygame.draw.ellipse(surf, body_c, (x + 18, y + 8 + bounce, 42, 38))
        # 耳朵
        pygame.draw.ellipse(surf, body_c, (x + 18, y + bounce, 16, 22))
        pygame.draw.ellipse(surf, belly_c, (x + 21, y + 4 + bounce, 10, 14))
        pygame.draw.ellipse(surf, body_c, (x + 42, y + bounce, 16, 22))
        pygame.draw.ellipse(surf, belly_c, (x + 45, y + 4 + bounce, 10, 14))
        # 眼睛
        pygame.draw.circle(surf, (40, 30, 20), (x + 42, y + 22 + bounce), 6)
        pygame.draw.circle(surf, (255, 255, 255), (x + 44, y + 20 + bounce), 2)
        # 鼻子
        pygame.draw.circle(surf, (200, 80, 60), (x + 55, y + 30 + bounce), 4)
        # 橡果在手
        pygame.draw.ellipse(surf, (212, 175, 55), (x - 5, y + 40 + bounce, 20, 16))
        pygame.draw.ellipse(surf, (120, 70, 30), (x - 1, y + 35 + bounce, 12, 8))

    @staticmethod
    def _draw_overlay(surf, title, sub, font, hint):
        overlay = pygame.Surface((SCREEN_W, SCREEN_H), pygame.SRCALPHA)
        overlay.fill((0, 0, 0, 160))
        surf.blit(overlay, (0, 0))

        t = font.render(title, True, (255, 240, 100))
        surf.blit(t, (SCREEN_W // 2 - t.get_width() // 2, SCREEN_H // 2 - 50))

        s = FONT_MID.render(sub, True, (220, 220, 220))
        surf.blit(s, (SCREEN_W // 2 - s.get_width() // 2, SCREEN_H // 2 + 20))

        hint_surf = FONT_SM.render(hint, True, (180, 180, 180))
        surf.blit(hint_surf, (SCREEN_W // 2 - hint_surf.get_width() // 2, SCREEN_H // 2 + 70))

    # ─── 工具方法 ────────────────────────────────────────
    def _spawn_particles(self, x, y, color, count):
        for _ in range(count):
            self.particles.append(Particle(x, y, color))

    def _start_game(self):
        self.level = 1
        self.score = 0
        self._build_level()
        self.state = GameState.PLAYING
        self.cam_x = 0
        self.cam_y = 0
        self.particles.clear()
        self.float_texts.clear()

    def _next_level(self):
        self.level += 1
        if self.level > self.max_level:
            self.state = GameState.VICTORY
            return
        self._build_level()
        self.state = GameState.PLAYING
        self.cam_x = 0
        self.cam_y = 0
        self.particles.clear()
        self.float_texts.clear()


# 用于渐变计算的小工具
class Col(tuple):
    pass


# ─── 主循环 ─────────────────────────────────────────────
def main():
    game = SquirrelGame()

    running = True
    while running:
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                running = False
            elif event.type == pygame.KEYDOWN:
                if event.key == pygame.K_ESCAPE and game.state == GameState.PLAYING:
                    game.state = GameState.PAUSED
                else:
                    game.handle_event(event)
            else:
                game.handle_event(event)

        game.update()
        game.draw(_screen)
        pygame.display.flip()
        clock.tick(FPS)

    pygame.quit()
    sys.exit()


if __name__ == "__main__":
    main()
