import { createCore } from './packages/core/dist/index.js';

async function run() {
  const core = createCore({ dataDir: './data' });
  await core.initialize();
  
  const user = core.getUserByUsername('admin');
  console.log('Old hash:', user.passwordHash);
  
  const newHash = await core.auth.hashPassword('newpass123');
  console.log('New hash generated:', newHash);
  
  const updated = await core.updateUserPassword(user.id, newHash);
  console.log('Updated:', updated);
  
  const userAfter = core.getUserByUsername('admin');
  console.log('Hash in DB:', userAfter.passwordHash);
  
  const isValid = await core.auth.verifyPassword('newpass123', userAfter.passwordHash);
  console.log('Verify with new pass:', isValid);
}
run();
