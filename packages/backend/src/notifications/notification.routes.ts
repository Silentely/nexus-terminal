import { Router } from 'express';
import { NotificationController } from './notification.controller';
import { isAuthenticated } from '../auth/auth.middleware';

const router = Router();
const notificationController = new NotificationController();

router.use(isAuthenticated);

router.get('/', notificationController.getAll);
router.post('/', notificationController.create);
router.put('/:id', notificationController.update);
router.delete('/:id', notificationController.delete);

router.post('/:id/test', notificationController.testSetting);

router.post('/test-unsaved', notificationController.testUnsavedSetting);

export default router;
