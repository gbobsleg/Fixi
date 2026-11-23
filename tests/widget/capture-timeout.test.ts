// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The library is replaced: these tests are about WHEN Fixi calls it, not about the rendering itself.
const domToCanvas = vi.fn();
vi.mock('modern-screenshot', () => ({ domToCanvas: (...args: unknown[]) => domToCanvas(...args) }));

const quietFetch = vi.fn();
vi.mock('../../src/widget/native.js', async (importActual) => ({
  ...(await importActual<typeof import('../../src/widget/native.js')>()),
  quietFetch: (...args: unknown[]) => quietFetch(...args),
}));

const { captureViewport, fetchImage } = await import('../../src/widget/capture.js');

/** A canvas whose toBlob works (jsdom does not implement canvas). */
function fakeCanvas(): HTMLCanvasElement {
  return { width: 10, height: 10, toBlob: (cb: BlobCallback) => cb(new Blob(['png'])) } as unknown as HTMLCanvasElement;
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
}

beforeEach(() => {
  domToCanvas.mockReset();
  quietFetch.mockReset();
  HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback) {
    cb(new Blob(['png']));
  };
});
afterEach(() => vi.useRealTimers());

describe('captureViewport budget', () => {
  it('gives up after 8 s and resolves to null, without throwing', async () => {
    vi.useFakeTimers();
    domToCanvas.mockReturnValue(new Promise(() => {})); // never ends
    const result = captureViewport();
    await vi.advanceTimersByTimeAsync(8000);
    await expect(result).resolves.toBeNull();
  });

  it('does not start the full-page fallback once the budget is spent', async () => {
    vi.useFakeTimers();
    const slow = deferred<HTMLCanvasElement>();
    domToCanvas.mockReturnValueOnce(slow.promise).mockResolvedValue(fakeCanvas());
    const result = captureViewport();
    await vi.advanceTimersByTimeAsync(8000);
    await expect(result).resolves.toBeNull();

    slow.reject(new Error('late failure')); // the first render fails AFTER the timeout
    await vi.advanceTimersByTimeAsync(0);
    expect(domToCanvas).toHaveBeenCalledTimes(1); // no second render burning CPU in the background
  });

  it('still uses the fallback when the first render fails in time', async () => {
    domToCanvas.mockRejectedValueOnce(new Error('render error')).mockResolvedValue(fakeCanvas());
    const result = await captureViewport();
    expect(domToCanvas).toHaveBeenCalledTimes(2);
    expect(result).not.toBeNull();
  });

  it('passes a 3 s per-resource timeout and its own image fetcher to the library', async () => {
    domToCanvas.mockResolvedValue(fakeCanvas());
    await captureViewport();
    const options = domToCanvas.mock.calls[0][1];
    expect(options.timeout).toBe(3000);
    expect(options.fetchFn).toBe(fetchImage);
  });
});

describe('fetchImage', () => {
  it('returns data: URLs untouched, without any download', async () => {
    await expect(fetchImage('data:image/png;base64,AAAA')).resolves.toBe('data:image/png;base64,AAAA');
    expect(quietFetch).not.toHaveBeenCalled();
  });

  it('downloads through quietFetch (never window.fetch) and returns a data: URL', async () => {
    quietFetch.mockResolvedValue(new Response('img', { headers: { 'content-type': 'image/png' } }));
    await expect(fetchImage('http://localhost/shifti/img/avatar.png')).resolves.toMatch(/^data:image\/png;base64,/);
    expect(quietFetch).toHaveBeenCalledWith('http://localhost/shifti/img/avatar.png', { cache: 'force-cache' });
  });

  it('draws a failed image transparent instead of letting the library retry with window.fetch', async () => {
    quietFetch.mockResolvedValue(null);
    await expect(fetchImage('http://slow.example/x.png')).resolves.toMatch(/^data:image\/gif;base64,/);
  });
});
