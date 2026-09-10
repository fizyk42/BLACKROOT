/**
 * PublicOnline — GTA Online-style public matchmaking on top of BLACKROOT's
 * existing room protocol. A player asks the server to place them into the
 * first non-full public room; if none exists, the server creates one.
 */
export const PUBLIC_CODE = 'PUBLIC';

export async function joinPublic(net, url, opts = {}) {
  return net.join(url, PUBLIC_CODE, { ...opts, public: true });
}
