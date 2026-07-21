const { verify } = require('argon2');
(async () => {
  const hash = '$argon2id$v=19$m=65536,t=3,p=4$/vbn4XVxR6Ix/FcL4wZaxQ$soGUizkEES3kpQjRmIWq6ueIuZF9EVOaW++lpcJX/xI';
  try {
    const result = await verify(hash, 'admin');
    console.log('is valid:', result);
  } catch(e) {
    console.error('error:', e.message);
  }
})();
