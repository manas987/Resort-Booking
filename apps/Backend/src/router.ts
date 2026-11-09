import { Router } from 'express';
import { adminRouter } from './routes/admin/router.ts';
import { systemRouter } from './routes/system/router.ts';
import { userRouter } from './routes/user/router.ts';

/**
 * The API's table of contents. Three mounts, nothing else — no logic, no SQL, no guards.
 *
 * Trace any endpoint from here:
 *   router.ts → routes/<tree>/<feature>/routes.ts → controllers.ts → schema.ts → core/
 */
export const apiRouter = Router();

apiRouter.use('/api/user', userRouter);
apiRouter.use('/api/admin', adminRouter);
apiRouter.use(systemRouter);
