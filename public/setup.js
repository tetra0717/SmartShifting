const $ = id => document.getElementById(id);
function links(id, urls) {
  const nodes = [...new Set(urls)].map(url => {
    const link = document.createElement('a'); link.href = url; link.textContent = url;
    link.style.display = 'block'; link.style.overflowWrap = 'anywhere'; return link;
  });
  $(id).replaceChildren(...nodes);
}
try {
  const response = await fetch('/api/info');
  if (!response.ok) throw new Error('接続情報を取得できません。サーバーの起動を確認してください。');
  const info = await response.json(), addresses = info.addresses || [];
  links('setupUrls', addresses.map(ip => `http://${ip}:${info.httpPort}/setup`));
  if (!addresses.length) $('setupUrls').textContent = 'PCをスマホと同じWi-Fiへ接続してください。';
  $('certificate').hidden = !info.caAvailable;
  if (info.caAvailable) $('fingerprint').textContent = info.caFingerprint;
  else $('certificateStatus').textContent = info.https ? 'このPCは既存のHTTPS証明書を使用しています。信頼済みなら、そのまま次のカメラページを開いてください。' : 'HTTPSが起動していません。ターミナルのエラーを確認してください。';
  const phoneUrls = info.https ? addresses.map(ip => `https://${ip}:${info.httpsPort}/phone`) : [];
  if (info.publicUrl) phoneUrls.push(new URL('/phone', info.publicUrl).href);
  links('phoneUrls', phoneUrls);
} catch (error) { $('setupError').textContent = error.message; }
