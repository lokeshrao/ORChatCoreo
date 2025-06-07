import { app, server } from './app.mjs';

const PORT = parseInt(process.env.PORT) || 8080;

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
