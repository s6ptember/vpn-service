import { config } from '../config';
import { createDb } from './client';

export { createDb, type Db } from './client';

export const db = createDb(config.DATABASE_PATH);
