import { Router } from 'express';
import * as QuickCommandsController from './quick-commands.controller';
import { isAuthenticated } from '../auth/auth.middleware';

const router = Router();

router.use(isAuthenticated);

// 定义路由
router.post('/', QuickCommandsController.addQuickCommand); // POST /api/v1/quick-commands
router.get('/', QuickCommandsController.getAllQuickCommands); // GET /api/v1/quick-commands?sortBy=name|usage_count
router.put('/:id', QuickCommandsController.updateQuickCommand); // PUT /api/v1/quick-commands/:id
router.delete('/:id', QuickCommandsController.deleteQuickCommand); // DELETE /api/v1/quick-commands/:id
router.post('/:id/increment-usage', QuickCommandsController.incrementUsage); // POST /api/v1/quick-commands/:id/increment-usage
router.post('/bulk-assign-tag', QuickCommandsController.assignTagToCommands); // POST /api/v1/quick-commands/bulk-assign-tag

export default router;
