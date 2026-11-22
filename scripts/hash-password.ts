// Generates the bcrypt hash expected in ADMIN_PASSWORD_HASH.
// Usage: npm run hash-password            (prompts, input hidden)
//        echo "my-password" | npm run hash-password

import bcrypt from 'bcryptjs';

function readHidden(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let value = '';
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n' || ch === '\u0004') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          process.stdout.write('\n');
          resolve(value);
          return;
        }
        if (ch === '\u0003') process.exit(130); // Ctrl+C
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
}

const password = process.stdin.isTTY ? await readHidden('Mot de passe admin : ') : await readStdin();

if (password.length < 8) {
  console.error('Le mot de passe doit contenir au moins 8 caractères.');
  process.exit(1);
}

const hash = await bcrypt.hash(password, 12);
console.log('\nHash bcrypt (coût 12) :\n');
console.log(`  ${hash}\n`);
console.log("Dans .env (guillemets simples obligatoires, sinon les '$' sont interprétés) :");
console.log(`  ADMIN_PASSWORD_HASH='${hash}'\n`);
console.log("Directement dans un docker-compose.yml (chaque '$' doit être doublé) :");
console.log(`  ADMIN_PASSWORD_HASH: "${hash.replace(/\$/g, '$$$$')}"`);
