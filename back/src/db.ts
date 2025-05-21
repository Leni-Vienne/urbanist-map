import dotenv from 'dotenv';
import { drizzle } from 'drizzle-orm/bun-sql';
import { SQL } from 'bun';
dotenv.config({ path: '../../.env' });

const client = new SQL(process.env.DATABASE_URL!);
export const db = drizzle({ client });