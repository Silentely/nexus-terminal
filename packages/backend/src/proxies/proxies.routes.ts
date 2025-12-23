import express, { RequestHandler } from 'express';
import { isAuthenticated } from '../auth/auth.middleware';
import {
  getAllProxies,
  getProxyById,
  createProxy,
  updateProxy,
  deleteProxy,
} from './proxies.controller';

const router = express.Router();

router.use(isAuthenticated);

router.get('/', getAllProxies as RequestHandler);
router.get('/:id', getProxyById as RequestHandler);
router.post('/', createProxy as RequestHandler);
router.put('/:id', updateProxy as RequestHandler);
router.delete('/:id', deleteProxy as RequestHandler);

export default router;
