async (page) => {
  const prep = await page.context().newPage();
  page.__sim.prepPage = prep;
  await prep.goto('http://localhost:5173/');
  await prep.getByLabel('E-mail', { exact: true }).fill(page.__sim.email);
  await prep.getByLabel('Senha', { exact: true }).fill(page.__sim.password);
  await prep.getByRole('button', { name: 'Entrar', exact: true }).click();
  await prep.getByRole('button', { name: 'Acessar conta', exact: true }).click();
  const code = await prep.evaluate(async secret => {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = '';
    for (const char of secret.toUpperCase().replace(/=+$/, '')) bits += alphabet.indexOf(char).toString(2).padStart(5, '0');
    const key = new Uint8Array(Math.floor(bits.length / 8));
    for (let i = 0; i < key.length; i++) key[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
    const counter = new Uint8Array(8);
    new DataView(counter.buffer).setBigUint64(0, BigInt(Math.floor(Date.now() / 30000)));
    const signing = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
    const hash = new Uint8Array(await crypto.subtle.sign('HMAC', signing, counter));
    const offset = hash.at(-1) & 15;
    return (((hash[offset] & 127) << 24 | hash[offset + 1] << 16 | hash[offset + 2] << 8 | hash[offset + 3]) % 1000000).toString().padStart(6, '0');
  }, page.__sim.totp);
  await prep.getByLabel('Código de verificação', { exact: true }).fill(code);
  await prep.getByRole('button', { name: 'Verificar', exact: true }).click();
  await prep.getByLabel('Chave pessoal', { exact: true }).fill(page.__sim.key);
  await prep.getByRole('button', { name: 'Desbloquear prontuários', exact: true }).click();
  await prep.getByRole('link', { name: 'Acervo pessoal', exact: true }).click();
  await page.bringToFront();
  return { step: 'Segunda sessão autenticada mantém o preparo do acervo durante os atendimentos', sharedRefreshToken: false };
}
