import { Router } from 'express';
import * as FavoritePathsController from './favorite-paths.controller';
import { isAuthenticated } from '../auth/auth.middleware';

const router = Router();

// 应用认证中间件，确保所有路径收藏相关的API都需要用户认证
router.use(isAuthenticated);

// 定义路由
router.post('/', FavoritePathsController.createFavoritePath); // POST /api/favorite-paths
router.get('/', FavoritePathsController.getAllFavoritePaths); // GET /api/favorite-paths?sortBy=name|usage_count
router.get('/:id', FavoritePathsController.getFavoritePathById); // GET /api/favorite-paths/:id
router.put('/:id', FavoritePathsController.updateFavoritePath); // PUT /api/favorite-paths/:id
router.delete('/:id', FavoritePathsController.deleteFavoritePath); // DELETE /api/favorite-paths/:id
router.put('/:id/update-last-used', FavoritePathsController.updateLastUsedTimestamp); // PUT /api/favorite-paths/:id/update-last-used

export default router;
