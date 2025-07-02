import { Elysia } from 'elysia';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ElysiaAdapter } from '@bull-board/elysia';
import { sessionQueue } from './queue';
import { createLogger } from '@/shared/logger';

const logger = createLogger('bull-board');

// Create the Bull Board server adapter
export const serverAdapter = new ElysiaAdapter("/ui");

// Create Bull Board with the session queue
createBullBoard({
  queues: [
    new BullMQAdapter(sessionQueue)
  ],
  serverAdapter: serverAdapter,
});