import dotenv from 'dotenv';
import { drizzle } from 'drizzle-orm/bun-sql';
import { SQL } from 'bun';
dotenv.config({ path: '../../.env' });

// to prevent too many connections, credit to Kairu https://www.answeroverflow.com/m/1216181725722578954
let client = undefined;
if (!client) {
    client = new SQL(process.env.DATABASE_URL!);
}
export const db = drizzle({ client });

