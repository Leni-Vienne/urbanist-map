import { drizzle } from 'drizzle-orm/bun-sql';
import { SQL } from 'bun';
import { config } from './config';
import * as schema from './db/schema';

// AI : to prevent too many connections, credit to Kairu https://www.answeroverflow.com/m/1216181725722578954
let client = undefined;
client ??= new SQL(config.DATABASE_URL);
export const db = drizzle({ client, schema });
