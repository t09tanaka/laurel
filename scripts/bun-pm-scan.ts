const proc = Bun.spawn(['bun', 'pm', 'scan'], {
  stdout: 'inherit',
  stderr: 'pipe',
});

const stderr = await new Response(proc.stderr).text();
if (stderr) process.stderr.write(stderr);

const code = await proc.exited;
if (code === 0) process.exit(0);

if (stderr.includes('no security scanner configured')) {
  console.warn('bun pm scan skipped: no [install.security].scanner is configured in bunfig.toml.');
  process.exit(0);
}

process.exit(code);
