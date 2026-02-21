import { createServer } from './app.js';

const port = Number(process.env.PORT || 5477);
const host = process.env.HOST || '0.0.0.0';

const server = createServer();

server.listen(port, host, () => {
  // eslint-disable-next-line no-console
  console.log(`superannuation-api listening on http://${host}:${port}`);
});
