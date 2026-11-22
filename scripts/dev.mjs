// Runs the server (watch) and the widget bundler (watch) together.
import { spawn } from 'node:child_process';

const children = ['dev:server', 'dev:widget'].map((script) =>
  spawn('npm', ['run', script], { stdio: 'inherit', shell: true }),
);

const stop = () => children.forEach((c) => c.kill());
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
children.forEach((c) => c.on('exit', (code) => code && stop()));
