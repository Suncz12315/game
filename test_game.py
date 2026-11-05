"""
松鼠大作战 - 单元测试
"""

import unittest
import pygame

from game_engine import (
    Player, Enemy, TileMap, Acorn, Spring,
    GRAVITY, MAX_FALL, TILE, load_level,
)

pygame.init()
pygame.display.set_mode((1, 1))


class TestTileMap(unittest.TestCase):
    def setUp(self):
        self.map = TileMap([
            "        ",
            "   P    ",
            "  ===   ",
            "########",
        ])

    def test_dimensions(self):
        self.assertEqual(self.map.h, 4)
        self.assertEqual(self.map.w, 8)

    def test_solid_detection(self):
        self.assertTrue(self.map.is_solid(0, 3))   # #
        self.assertFalse(self.map.is_solid(3, 1))  # space

    def test_player_spawn(self):
        self.assertEqual(self.map.player_spawn, (3 * TILE, 1 * TILE))

    def test_acorn_parsing(self):
        m = TileMap(["  A  ", " #####"])
        self.assertEqual(len(m.acorns), 1)

    def test_enemy_spawn_parsing(self):
        m = TileMap([" E ", "###"])
        self.assertEqual(len(m.enemies_spawns), 1)


class TestPlayer(unittest.TestCase):
    def setUp(self):
        self.tm = TileMap(["    ", "####"])
        self.p = Player(20, 20)

    def test_gravity(self):
        self.p.apply_gravity()
        self.assertGreater(self.p.vy, 0)

    def test_max_fall_speed(self):
        self.p.vy = 100
        self.p.apply_gravity()
        self.assertEqual(self.p.vy, MAX_FALL)

    def test_jump(self):
        self.p.vy = -15
        initial = self.p.vy
        self.p.apply_gravity()
        self.assertGreater(self.p.vy, initial)  # 重力应使 vy 增大

    def test_die(self):
        self.p.lives = 3
        self.p.die()
        self.assertEqual(self.p.lives, 2)

    def test_dead_when_no_lives(self):
        self.p.lives = 0
        self.p.die()
        self.assertTrue(self.p.dead)


class TestEnemy(unittest.TestCase):
    def test_movement(self):
        tm = TileMap(["          ", "##########"])
        e = Enemy(40, 8, 'walker')
        vx_before = e.vx
        e.update(tm)
        self.assertNotEqual(e.x, 40)  # 敌人应移动了

    def test_thrown_gravity(self):
        tm = TileMap(["   ", "###"])
        e = Enemy(20, 8, 'walker')
        e.thrown = True
        e.vy = -10
        e.update(tm)
        self.assertGreater(e.vy, -10)  # 重力作用


class TestAcorn(unittest.TestCase):
    def test_collection(self):
        a = Acorn(40, 40)
        self.assertFalse(a.collected)
        a.collected = True
        self.assertTrue(a.collected)


class TestSpring(unittest.TestCase):
    def test_activation(self):
        s = Spring(40, 40)
        self.assertEqual(s.anim, 0)
        s.activate()
        self.assertEqual(s.anim, 8)

    def test_update_decreases_anim(self):
        s = Spring(40, 40)
        s.activate()
        s.update()
        self.assertEqual(s.anim, 7)


class TestCollision(unittest.TestCase):
    def test_solid_blocks_player(self):
        tm = TileMap(["####", "####"])
        p = Player(10, 10)
        p.vx = 5
        p.move_and_collide(tm)
        self.assertLess(p.x, 20)  # 被砖块挡住

    def test_fall_on_ground(self):
        tm = TileMap(["    ", "===="])
        p = Player(20, 8)
        p.apply_gravity()
        p.move_and_collide(tm)
        self.assertTrue(p.on_ground)


class TestLevelLoader(unittest.TestCase):
    def test_level1_loads(self):
        tm = load_level(1)
        self.assertIsNotNone(tm)
        self.assertGreater(len(tm.acorns), 0)

    def test_level2_loads(self):
        tm = load_level(2)
        self.assertIsNotNone(tm)

    def test_level3_loads(self):
        tm = load_level(3)
        self.assertIsNotNone(tm)


if __name__ == "__main__":
    unittest.main()
