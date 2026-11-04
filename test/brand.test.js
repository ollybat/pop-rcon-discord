// PUBLIC_URL has to be set before src/theme.js is loaded, so this file imports everything by hand.
process.env.PUBLIC_URL = 'https://bot.example.test/';

const assert = (await import('node:assert/strict')).default;
const { get: httpGet } = await import('node:http');
const { test } = await import('node:test');
const { baseEmbed } = await import('../src/embeds.js');
const { BRAND_LOGO, BRAND_MARK } = await import('../src/theme.js');
const { createHealthServer } = await import('../src/web.js');

/** A GET that keeps the body as bytes - the mark is a GIF, not text. */
function raw(url) {
  return new Promise((resolve, reject) => {
    httpGet(url, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}

test('the mark is a small animated GIF the bot serves itself', async () => {
  assert.equal(BRAND_LOGO, 'https://bot.example.test/logo.png');
  assert.equal(BRAND_MARK, 'https://bot.example.test/mark.gif');

  const server = createHealthServer({ port: 0, host: '127.0.0.1', status: () => ({}) });
  const node = await server.start();
  const base = 'http://127.0.0.1:' + node.address().port;

  const mark = await raw(base + '/mark.gif');
  assert.equal(mark.status, 200);
  assert.equal(mark.headers['content-type'], 'image/gif');
  assert.equal(mark.body.subarray(0, 6).toString('latin1'), 'GIF89a', 'a real GIF, not a placeholder');
  assert.equal(mark.body.readUInt16LE(6), 80, 'eighty pixels wide - deliberately small');
  assert.equal(mark.body.readUInt16LE(8), 80, 'and square');
  assert.ok(mark.body.includes(Buffer.from('NETSCAPE2.0')), 'it loops forever');
  assert.ok(mark.body.length > 10000, 'the animation is bundled, not one frame');
  assert.ok(mark.body.length < 100000, 'small enough to sign every embed');

  const health = await raw(base + '/health');
  assert.equal(JSON.parse(health.body.toString('utf8')).mark, BRAND_MARK);

  assert.equal((await raw(base + '/logo.png')).status, 200, 'the still logo is still served');

  await server.stop();
});

test('every embed wears the mark at the bottom, not in the corner', () => {
  const embed = baseEmbed();
  assert.equal(embed.data.image.url, 'https://bot.example.test/mark.gif');
  assert.equal(embed.data.thumbnail, undefined);
  assert.equal(embed.data.footer.text, 'Powered by Spinback');
  assert.equal(baseEmbed({ logo: false }).data.image, undefined);
  assert.equal(baseEmbed({ color: 0x123456 }).data.image.url, BRAND_MARK, 'colour does not change the mark');
});
