import { describe, expect, it } from 'vitest';
import {
  extractPackRequests,
  fileNumber,
  loadPackRequests,
  PackListError,
  packSource,
  parsePackData,
  pickOnePeerPerFile,
  sameNetwork,
  toBatches,
  xdccParserDataUrl,
} from './packlist';

describe('extractPackRequests', () => {
  it('finds requests in html text, through tags and entities', () => {
    const html = `<html><script>/msg Evil xdcc send #9</script>
      <p><code>/msg [Bot]|1 xdcc send #12</code></p>
      <li>/msg <b>Other</b> xdcc get &#35;7</li>
      <pre>/MSG Bot&amp;Co xdcc send 3</pre>`;
    expect(extractPackRequests(html).map(({ bot, pack }) => ({ bot, pack }))).toEqual([
      { bot: '[Bot]|1', pack: 12 },
      { bot: 'Other', pack: 7 },
      { bot: 'Bot&Co', pack: 3 },
    ]);
  });
  it('drops duplicates, ranges and bare xdcc lines', () => {
    expect(
      extractPackRequests(
        '/msg A xdcc send #1 /msg a xdcc send #1 /msg A xdcc send #2-5 xdcc send #4 /msg A xdcc send #0',
      ),
    ).toMatchObject([{ bot: 'A', pack: 1 }]);
  });
});

describe('toBatches', () => {
  it('makes one sorted batch per bot, with consecutive packs as ranges', () => {
    const reqs = [5, 1, 2, 3, 9].map((pack) => ({ bot: 'A', pack })).concat([{ bot: 'B', pack: 4 }]);
    expect(toBatches(reqs)).toEqual([
      { bot: 'A', spec: '1-3,5,9', count: 5 },
      { bot: 'B', spec: '4', count: 1 },
    ]);
  });
  it('splits a bot with too many packs across lines', () => {
    const reqs = Array.from({ length: 200 }, (_, i) => ({ bot: 'A', pack: i * 2 + 1 }));
    const batches = toBatches(reqs);
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.every((b) => b.spec.length <= 300)).toBe(true);
    expect(batches.reduce((n, b) => n + b.count, 0)).toBe(200);
  });
});

describe('file names next to requests', () => {
  it('takes the name from the same row, or the line above', () => {
    const html = `<tr><td>Show - 05.mkv</td><td>/msg A xdcc send #1</td></tr>
      <p>Show - 06.mkv</p><p>/msg A xdcc send #2</p>
      <li>/msg B xdcc send #3 Other 07.mkv</li>`;
    expect(extractPackRequests(html).map((r) => r.name)).toEqual(['Show - 05.mkv', 'Show - 06.mkv', 'Other 07.mkv']);
  });
});

describe('fileNumber', () => {
  it.each([
    ['[Grp] Show - 12 [1080p][ABCD1234].mkv', 12],
    ['Show.S02E05.1080p.x264.mkv', 5],
    ['Show E07 720p.mkv', 7],
    ['Show 2020 03.mkv', 3],
    ['Show - 13v2.mkv', 13],
    ['Movie.2020.1080p.mkv', null],
    ['', null],
  ])('%s -> %s', (name, expected) => {
    expect(fileNumber(name)).toBe(expected);
  });
});

const SHELL = `<body onload="p.init('https://subsplease.org/xdcc/');"><div id="listtable">Javascript is required</div></body>`;
const DATA = `p.k[0] = {b:"Ginpachi-Sensei", n:4312, s:371, f:"[SubsPlease] Kusuriya no Hitorigoto - 55 (480p) [AE5DB2BC].mkv"};
p.k[1] = {b:"Gattsu", n:12661, s:1331, f:"[SubsPlease] Kusuriya no Hitorigoto - 06 (1080p) [52C2FB3C].mkv"};
p.k[2] = {b:"Gattsu", n:12661, s:1331, f:"duplicate"};
p.k[3] = {b:"Gattsu", n:12700, s:0, f:"Quote \\"q\\" - 51.mkv"};`;

describe('XDCC Parser pages', () => {
  it('builds the data link from the search or bot in the page link', () => {
    const data = 'https://subsplease.org/xdcc/search.php';
    expect(xdccParserDataUrl(SHELL, 'https://subsplease.org/xdcc/?=Kusuriya%20no%20Hitorigoto#')).toBe(
      `${data}?t=Kusuriya%20no%20Hitorigoto`,
    );
    expect(xdccParserDataUrl(SHELL, 'https://subsplease.org/xdcc/?search=a+b')).toBe(`${data}?t=a%20b`);
    expect(xdccParserDataUrl(SHELL, 'https://subsplease.org/xdcc/?nick=Gattsu')).toBe(`${data}?nick=Gattsu`);
    expect(xdccParserDataUrl(SHELL, 'https://subsplease.org/xdcc/')).toBeNull();
    expect(xdccParserDataUrl('<p>plain</p>', 'https://x.org/?search=a')).toBeNull();
  });

  it('reads the rows as data', () => {
    expect(parsePackData(DATA)).toEqual([
      { bot: 'Ginpachi-Sensei', pack: 4312, name: '[SubsPlease] Kusuriya no Hitorigoto - 55 (480p) [AE5DB2BC].mkv' },
      { bot: 'Gattsu', pack: 12661, name: '[SubsPlease] Kusuriya no Hitorigoto - 06 (1080p) [52C2FB3C].mkv' },
      { bot: 'Gattsu', pack: 12700, name: 'Quote "q" - 51.mkv' },
    ]);
  });

  it('falls back to the data when the page itself has no commands', async () => {
    const fetched: string[] = [];
    const fetchPage = async (url: string) => {
      fetched.push(url);
      return url.includes('search.php') ? DATA : SHELL;
    };
    const found = await loadPackRequests('https://subsplease.org/xdcc/?=Kusuriya', fetchPage);
    expect(found.requests).toHaveLength(3);
    expect(fetched).toEqual([
      'https://subsplease.org/xdcc/?=Kusuriya',
      'https://subsplease.org/xdcc/search.php?t=Kusuriya',
    ]);
  });

  it('keeps the commands written on a page and does not fetch more', async () => {
    const fetchPage = async () => '<p>/msg A xdcc send #1</p>';
    expect((await loadPackRequests('https://x.org/p', fetchPage)).requests).toMatchObject([{ bot: 'A', pack: 1 }]);
  });

  it('says which required part is missing', async () => {
    const reason = (html: string, link: string, data = '') =>
      loadPackRequests(link, async (u) => (u.includes('search.php') ? data : html)).catch((e) => e);
    const notParser = await reason('<p>nothing</p>', 'https://x.org/p');
    expect(notParser).toBeInstanceOf(PackListError);
    expect(notParser.message).toMatch(/not an XDCC Parser packlist/);
    expect((await reason(SHELL, 'https://subsplease.org/xdcc/')).message).toMatch(/names no search or bot/);
    expect((await reason(SHELL, 'https://subsplease.org/xdcc/?=zzz', '')).message).toMatch(/found no packs/);
    expect((await reason(SHELL, 'https://subsplease.org/xdcc/?=zzz', 'p.k[0] = {x:1};')).message).toMatch(
      /no bot, pack number and file name/,
    );
  });
});

describe('pickOnePeerPerFile', () => {
  const r = (bot: string, pack: number, name?: string) => ({ bot, pack, name });
  it('takes a repeated file from the bot that offers most of the rest', () => {
    const picked = pickOnePeerPerFile([
      r('Few', 1, 'Show - 05.mkv'),
      r('Few', 2, 'Show - 06.mkv'),
      r('Many', 10, 'show - 05.MKV'),
      r('Many', 11, 'Show - 07.mkv'),
      r('Many', 12, 'Show - 08.mkv'),
      r('Many', 13, 'Show - 06.mkv'),
    ]);
    expect(picked.map((x) => `${x.bot}${x.pack}`).sort()).toEqual(['Many10', 'Many11', 'Many12', 'Many13']);
  });
  it('still uses a second bot for a file only it has, and keeps nameless requests', () => {
    const picked = pickOnePeerPerFile([r('A', 1, 'x.mkv'), r('A', 2, 'y.mkv'), r('B', 3, 'z.mkv'), r('C', 4)]);
    expect(picked.map((x) => x.pack).sort()).toEqual([1, 2, 3, 4]);
  });
  it('keeps one request when a bot lists the same file twice', () => {
    expect(pickOnePeerPerFile([r('A', 1, 'x.mkv'), r('A', 2, 'x.mkv')])).toHaveLength(1);
  });
});

describe('packSource', () => {
  it('reads the network and channel from the irc link', () => {
    expect(packSource('<a href="irc://irc.rizon.net/subsplease">#x</a>')).toEqual({
      host: 'irc.rizon.net',
      channel: '#subsplease',
    });
    expect(packSource('<a href="ircs://Irc.Example.org:6697/%23a"></a>')?.host).toBe('irc.example.org');
    expect(packSource('irc://irc.x.net/')).toEqual({ host: 'irc.x.net', channel: undefined });
    expect(packSource('<p>no link</p>')).toBeNull();
  });
  it('treats regional hosts of one network as the same', () => {
    expect(sameNetwork('irc.eu.rizon.net', 'irc.rizon.net')).toBe(true);
    expect(sameNetwork('irc.libera.chat', 'irc.rizon.net')).toBe(false);
  });
});
