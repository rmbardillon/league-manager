/**
 * Backend HTTP server entry point.
 */
// Load .env before importing ./app.js, which transitively imports the DB client
// that reads DATABASE_URL at module load time.
import './loadEnv.js';
import { createApp } from './app.js';

const port = Number(process.env.PORT ?? 3000);
const app = createApp();

app.listen(port, () => {
  console.log(`Basketball League Management API listening on port ${port}`);
});
