// @vitest-environment happy-dom
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/preact';
import type { TableGeometry } from '../../src/vision/mesh';
import { GridCheck } from '../../src/ui/GridCheck';

const { detectPhoto, meshFromCornersAsync, rotateSession, closeSession } = vi.hoisted(() => ({
  detectPhoto: vi.fn(), meshFromCornersAsync: vi.fn(), rotateSession: vi.fn(), closeSession: vi.fn(),
}));
vi.mock('../../src/worker/visionClient', () => ({ detectPhoto, meshFromCornersAsync, rotateSession, closeSession }));

// 1000 x 800 full-res photo; clue depth 1, crossings at 100 px pitch from (100,100).
function geo(confidence = 0.9, width = 20, height = 20): TableGeometry {
  const rowClueDepth = 1, colClueDepth = 1, cols = rowClueDepth + width, rows = colClueDepth + height;
  const xs = new Float32Array((cols + 1) * (rows + 1)), ys = new Float32Array(xs.length);
  for (let r = 0; r <= rows; r++) for (let c = 0; c <= cols; c++) { xs[r * (cols + 1) + c] = 100 + c * 30; ys[r * (cols + 1) + c] = 100 + r * 30; }
  return { rotation: 0, width, height, colClueDepth, rowClueDepth, cols, rows, xs, ys, confidence };
}
const session = { id: 7, width: 1000, height: 800, preview: { width: 500, height: 400 } };
const ok = (g = geo()) => ({ session, result: { ok: true, geometry: g, ms: 5 }, ms: 5 });
const file = new File(['x'], 'a.jpg');

beforeEach(() => {
  vi.clearAllMocks();
  detectPhoto.mockResolvedValue(ok());
  meshFromCornersAsync.mockResolvedValue(geo());
  HTMLCanvasElement.prototype.getContext = (() => ({
    drawImage() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
  })) as never;
  Element.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, width: 500, height: 400, right: 500, bottom: 400, x: 0, y: 0, toJSON() {} });
});
afterEach(async () => { cleanup(); await new Promise((r) => setTimeout(r, 20)); }); // let unmount effect cleanups (closeSession) land in their own test

const mount = (p: Partial<Parameters<typeof GridCheck>[0]> = {}) => {
  const onConfirm = vi.fn(), onCancel = vi.fn();
  render(<GridCheck file={file} onConfirm={onConfirm} onCancel={onCancel} {...p} />);
  return { onConfirm, onCancel };
};
const use = () => screen.getByRole('button', { name: 'Use this grid' }) as HTMLButtonElement;
const drag = (name: string, x: number, y: number) => {
  const h = screen.getByLabelText(name), [l, t] = (h.getAttribute('style')!.match(/[\d.]+(?=%)/g) ?? []).map(Number);
  fireEvent.pointerDown(h, { pointerId: 1, clientX: l * 5, clientY: t * 4 }); // on the handle centre (box 500 x 400)
  fireEvent.pointerMove(h, { pointerId: 1, clientX: x, clientY: y });
  fireEvent.pointerUp(h, { pointerId: 1, clientX: x, clientY: y });
};

test('success: shows the detected size and confirms the geometry', async () => {
  const { onConfirm } = mount();
  expect(screen.getByText('Reading the photo…')).toBeTruthy();
  await waitFor(() => expect(use().disabled).toBe(false));
  expect((screen.getByLabelText('Size') as HTMLSelectElement).value).toBe('20x20');
  fireEvent.click(use());
  await waitFor(() => expect(onConfirm).toHaveBeenCalled());
  expect(onConfirm.mock.calls[0][0].sessionId).toBe(7);
  expect(onConfirm.mock.calls[0][0].geometry.width).toBe(20);
});

test('detected known size is preselected', async () => {
  detectPhoto.mockResolvedValue(ok(geo(0.9, 25, 35)));
  mount();
  await waitFor(() => expect((screen.getByLabelText('Size') as HTMLSelectElement).value).toBe('25x35'));
});

test('low confidence shows the warning', async () => {
  detectPhoto.mockResolvedValue(ok(geo(0.3)));
  mount();
  await screen.findByText('Check the size and clue depths — the photo was hard to read.');
  expect(use().disabled).toBe(false);
});

test('failure: message, default handles, 25x30 preselected', async () => {
  detectPhoto.mockResolvedValue({ session, result: { ok: false, reason: 'x' }, ms: 5 });
  mount();
  await screen.findByText('Could not find the puzzle in this photo. Move the 4 corners onto the grid corners.');
  expect((screen.getByLabelText('Size') as HTMLSelectElement).value).toBe('25x30');
  expect(screen.getByLabelText('Top-left corner').getAttribute('style')).toContain('left: 15%');
  expect(screen.getByLabelText('Bottom-right corner').getAttribute('style')).toContain('left: 85%');
});

test('knownSize overrides the detected size', async () => {
  mount({ knownSize: { width: 20, height: 20, colClueDepth: 5, rowClueDepth: 6 } });
  await waitFor(() => expect((screen.getByLabelText('Size') as HTMLSelectElement).value).toBe('20x20'));
  expect((screen.getByLabelText('Row clue depth') as HTMLInputElement).value).toBe('6');
});

test('crossed corners disable the button and skip the re-mesh', async () => {
  mount();
  await waitFor(() => expect(use().disabled).toBe(false));
  drag('Top-left corner', 450, 350); // past the bottom-right corner
  await screen.findByText('The corners are crossed.');
  expect(use().disabled).toBe(true);
  expect(meshFromCornersAsync).not.toHaveBeenCalled();
});

test('a corner dragged outside the photo is clamped', async () => {
  mount();
  await waitFor(() => expect(use().disabled).toBe(false));
  drag('Top-left corner', -50, -50);
  await waitFor(() => expect(meshFromCornersAsync).toHaveBeenCalled());
  const corners = meshFromCornersAsync.mock.calls[0][1];
  expect(corners[0]).toEqual({ x: 0, y: 0 });
});

test('changing the size re-meshes with the new size', async () => {
  mount();
  await waitFor(() => expect(use().disabled).toBe(false));
  fireEvent.change(screen.getByLabelText('Size'), { target: { value: '20x15' } });
  await waitFor(() => expect(meshFromCornersAsync).toHaveBeenCalled());
  expect(meshFromCornersAsync.mock.calls[0][0]).toBe(7);
  expect(meshFromCornersAsync.mock.calls[0][2]).toMatchObject({ width: 20, height: 15 });
});

test('Other shows width and height; a valid size re-meshes with it', async () => {
  mount();
  await waitFor(() => expect(use().disabled).toBe(false));
  fireEvent.change(screen.getByLabelText('Size'), { target: { value: 'other' } });
  fireEvent.input(screen.getByLabelText('Width'), { target: { value: '35' } });
  fireEvent.input(screen.getByLabelText('Height'), { target: { value: '50' } });
  await waitFor(() => expect(meshFromCornersAsync.mock.lastCall?.[2]).toMatchObject({ width: 35, height: 50 }));
});

test('Other: a side outside 1–50 disables the button and skips the re-mesh', async () => {
  mount();
  await waitFor(() => expect(use().disabled).toBe(false));
  fireEvent.change(screen.getByLabelText('Size'), { target: { value: 'other' } });
  const calls = meshFromCornersAsync.mock.calls.length;
  fireEvent.input(screen.getByLabelText('Width'), { target: { value: '51' } });
  expect(use().disabled).toBe(true);
  fireEvent.input(screen.getByLabelText('Width'), { target: { value: '0' } });
  expect(use().disabled).toBe(true);
  expect(meshFromCornersAsync.mock.calls.length).toBe(calls);
});

test('an unknown detected size opens Other with its numbers', async () => {
  detectPhoto.mockResolvedValue(ok(geo(0.4, 34, 49)));
  mount();
  await waitFor(() => expect((screen.getByLabelText('Size') as HTMLSelectElement).value).toBe('other'));
  expect((screen.getByLabelText('Width') as HTMLInputElement).value).toBe('34');
  expect((screen.getByLabelText('Height') as HTMLInputElement).value).toBe('49');
});

test('a rejecting re-mesh shows the crossed message instead of crashing', async () => {
  mount();
  await waitFor(() => expect(use().disabled).toBe(false));
  meshFromCornersAsync.mockRejectedValue(new Error('degenerate'));
  fireEvent.change(screen.getByLabelText('Size'), { target: { value: '20x15' } });
  await screen.findByText('The corners are crossed.');
  expect(use().disabled).toBe(true);
});

test('a read error shows the error text; Try again reads the same file again', async () => {
  detectPhoto.mockRejectedValueOnce(new Error('decode failed'));
  mount();
  await screen.findByText('Could not read the photo. (decode failed)');
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await waitFor(() => expect(use().disabled).toBe(false));
  expect(detectPhoto).toHaveBeenCalledTimes(2);
  expect(detectPhoto.mock.calls[1][0]).toBe(file);
});

test('rotate resets from the rotate result', async () => {
  rotateSession.mockResolvedValue({ session, result: { ok: false, reason: 'x' } });
  mount();
  await waitFor(() => expect(use().disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: 'Rotate' }));
  await screen.findByText(/Could not find the puzzle/);
  expect(rotateSession).toHaveBeenCalledWith(7, 1);
});

test('cancel closes the session', async () => {
  const { onCancel } = mount();
  await waitFor(() => expect(use().disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(onCancel).toHaveBeenCalled();
  expect(closeSession).toHaveBeenCalledWith(7);
});

test('Use this grid is disabled while a rotate is pending', async () => {
  let done!: (v: unknown) => void;
  rotateSession.mockReturnValue(new Promise((r) => { done = r; }));
  mount();
  await waitFor(() => expect(use().disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: 'Rotate' }));
  await waitFor(() => expect(use().disabled).toBe(true));
  done({ session, result: { ok: false, reason: 'x' } });
  await waitFor(() => expect(use().disabled).toBe(false));
});

test('Cancel on the rotate error screen closes the session', async () => {
  rotateSession.mockRejectedValue(new Error('boom'));
  const { onCancel } = mount();
  await waitFor(() => expect(use().disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: 'Rotate' }));
  await screen.findByText(/^Could not rotate the photo\. \(/);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(closeSession).toHaveBeenCalledWith(7);
  expect(onCancel).toHaveBeenCalled();
});

// Top-left grid corner is at (130, 130) full-res = (65, 65) CSS px (the box is 500 px wide for a 1000 px photo).
test('the grab offset is kept: a handle grabbed off-centre moves only by the pointer movement', async () => {
  mount();
  await waitFor(() => expect(use().disabled).toBe(false));
  const h = screen.getByLabelText('Top-left corner');
  fireEvent.pointerDown(h, { pointerId: 1, clientX: 60, clientY: 40 });
  fireEvent.pointerMove(h, { pointerId: 1, clientX: 80, clientY: 40 });
  fireEvent.pointerUp(h, { pointerId: 1, clientX: 80, clientY: 40 });
  await waitFor(() => expect(meshFromCornersAsync).toHaveBeenCalled());
  expect(meshFromCornersAsync.mock.calls[0][1][0]).toEqual({ x: 170, y: 130 });
});

test('a tap on a handle (moved < 4 px) keeps the corner and skips the re-mesh', async () => {
  mount();
  await waitFor(() => expect(use().disabled).toBe(false));
  const h = screen.getByLabelText('Top-left corner');
  fireEvent.pointerDown(h, { pointerId: 1, clientX: 60, clientY: 40 });
  fireEvent.pointerMove(h, { pointerId: 1, clientX: 62, clientY: 41 });
  fireEvent.pointerUp(h, { pointerId: 1, clientX: 62, clientY: 41 });
  await waitFor(() => expect(h.getAttribute('style')).toContain('left: 13%'));
  expect(meshFromCornersAsync).not.toHaveBeenCalled();
});

test('a cancelled drag puts the corner back without a re-mesh', async () => {
  mount();
  await waitFor(() => expect(use().disabled).toBe(false));
  const h = screen.getByLabelText('Top-left corner');
  fireEvent.pointerDown(h, { pointerId: 1, clientX: 50, clientY: 50 });
  fireEvent.pointerMove(h, { pointerId: 1, clientX: 450, clientY: 350 }); // crossed while dragging
  await screen.findByText('The corners are crossed.');
  fireEvent.pointerCancel(h, { pointerId: 1, clientX: 0, clientY: 0 });
  await waitFor(() => expect(h.getAttribute('style')).toContain('left: 13%; top: 16.25%'));
  expect(screen.queryByText('The corners are crossed.')).toBeNull();
  expect(meshFromCornersAsync).not.toHaveBeenCalled();
});

test('leaving the screen closes the session once', async () => {
  mount();
  await waitFor(() => expect(use().disabled).toBe(false));
  cleanup(); // the unmount effect cleanup runs after the render queue flushes
  await waitFor(() => expect(closeSession).toHaveBeenCalledWith(7));
  expect(closeSession).toHaveBeenCalledTimes(1);
});

test('after Use this grid, leaving the screen does not close the handed-over session', async () => {
  const { onConfirm } = mount();
  await waitFor(() => expect(use().disabled).toBe(false));
  fireEvent.click(use());
  await waitFor(() => expect(onConfirm).toHaveBeenCalled());
  cleanup(); await new Promise((r) => setTimeout(r, 20));
  expect(closeSession).not.toHaveBeenCalled();
});

test('a new file closes the old session', async () => {
  const p = { onConfirm: vi.fn(), onCancel: vi.fn() };
  const { rerender } = render(<GridCheck file={file} {...p} />);
  await waitFor(() => expect(use().disabled).toBe(false));
  detectPhoto.mockResolvedValue({ ...ok(), session: { ...session, id: 8 } });
  rerender(<GridCheck file={new File(['y'], 'b.jpg')} {...p} />);
  await waitFor(() => expect(closeSession).toHaveBeenCalledWith(7));
  await waitFor(() => expect(detectPhoto).toHaveBeenCalledTimes(2));
  expect(closeSession).not.toHaveBeenCalledWith(8);
});

test('knownGrid: size from the puzzle, depths from the detection', async () => {
  mount({ knownGrid: { width: 20, height: 20, fallbackDepth: { colClueDepth: 4, rowClueDepth: 5 } } });
  await waitFor(() => expect(use().disabled).toBe(false));
  expect((screen.getByLabelText('Size') as HTMLSelectElement).value).toBe('20x20');
  expect((screen.getByLabelText('Row clue depth') as HTMLInputElement).value).toBe('1');
});

test('knownGrid with a failed detection: mesh uses fallbackDepth', async () => {
  detectPhoto.mockResolvedValue({ session, result: { ok: false, reason: 'x' }, ms: 5 });
  mount({ knownGrid: { width: 20, height: 20, fallbackDepth: { colClueDepth: 4, rowClueDepth: 5 } } });
  await screen.findByText(/Could not find the puzzle/);
  expect((screen.getByLabelText('Row clue depth') as HTMLInputElement).value).toBe('5');
  fireEvent.click(use());
  await waitFor(() => expect(meshFromCornersAsync.mock.lastCall?.[2]).toMatchObject({ width: 20, height: 20, colClueDepth: 4, rowClueDepth: 5 }));
});

describe('size label', () => {
  const withLabel = (g: TableGeometry, label: { width: number; height: number } | null) => ({ ...ok(g), label });
  const MSG = 'The label says 25×30; the grid has 25×35. Check the size.';

  test('a sure label that disagrees is shown', async () => {
    detectPhoto.mockResolvedValue(withLabel(geo(0.9, 25, 35), { width: 25, height: 30 }));
    mount();
    await screen.findByText(MSG);
  });

  test('an agreeing or null label shows nothing', async () => {
    detectPhoto.mockResolvedValue(withLabel(geo(0.9, 25, 35), { width: 25, height: 35 }));
    mount();
    await waitFor(() => expect(use().disabled).toBe(false));
    expect(screen.queryByText(/The label says/)).toBeNull();
    cleanup();
    detectPhoto.mockResolvedValue(withLabel(geo(0.9, 25, 35), null));
    mount();
    await waitFor(() => expect(use().disabled).toBe(false));
    expect(screen.queryByText(/The label says/)).toBeNull();
  });

  test('low confidence takes the label size', async () => {
    const g = { ...geo(0.5, 25, 34), rowClueDepth: 3, colClueDepth: 4 };
    detectPhoto.mockResolvedValue(withLabel(g, { width: 25, height: 35 }));
    mount();
    await waitFor(() => expect(meshFromCornersAsync).toHaveBeenCalled());
    expect(meshFromCornersAsync.mock.calls[0][2]).toEqual({ width: 25, height: 35, rowClueDepth: 3, colClueDepth: 4 });
    expect((screen.getByLabelText('Size') as HTMLSelectElement).value).toBe('25x35');
    expect((screen.getByLabelText('Row clue depth') as HTMLInputElement).value).toBe('3');
    expect((screen.getByLabelText('Column clue depth') as HTMLInputElement).value).toBe('4');
  });

  test('the message hides once the size equals the label', async () => {
    detectPhoto.mockResolvedValue(withLabel(geo(0.9, 25, 35), { width: 25, height: 30 }));
    mount();
    await screen.findByText(MSG);
    fireEvent.change(screen.getByLabelText('Size'), { target: { value: '25x30' } });
    await waitFor(() => expect(screen.queryByText(/The label says/)).toBeNull());
  });

  test('the check is off when the size is known', async () => {
    detectPhoto.mockResolvedValue(withLabel(geo(0.9, 25, 35), { width: 25, height: 30 }));
    mount({ knownGrid: { width: 25, height: 35, fallbackDepth: { colClueDepth: 1, rowClueDepth: 1 } } });
    await waitFor(() => expect(use().disabled).toBe(false));
    expect(screen.queryByText(/The label says/)).toBeNull();
    expect((screen.getByLabelText('Size') as HTMLSelectElement).value).toBe('25x35');
  });

  describe('after rotate', () => {
    const rotated = (g: TableGeometry, label: { width: number; height: number } | null) => ({ session, result: { ok: true, geometry: g, ms: 5 }, label });
    const spin = async () => {
      mount();
      await waitFor(() => expect(use().disabled).toBe(false));
      meshFromCornersAsync.mockClear();
      fireEvent.click(screen.getByRole('button', { name: 'Rotate' }));
    };

    test('low confidence takes the label size and re-meshes with it', async () => {
      rotateSession.mockResolvedValue(rotated({ ...geo(0.5, 25, 34), rowClueDepth: 3, colClueDepth: 4 }, { width: 25, height: 35 }));
      await spin();
      await waitFor(() => expect(meshFromCornersAsync).toHaveBeenCalled());
      expect(meshFromCornersAsync.mock.calls[0][0]).toBe(7);
      expect(meshFromCornersAsync.mock.calls[0][2]).toEqual({ width: 25, height: 35, rowClueDepth: 3, colClueDepth: 4 });
      expect((screen.getByLabelText('Size') as HTMLSelectElement).value).toBe('25x35');
    });

    test('a sure mismatching label shows the message', async () => {
      rotateSession.mockResolvedValue(rotated(geo(0.9, 25, 35), { width: 25, height: 30 }));
      await spin();
      await screen.findByText('The label says 25×30; the grid has 25×35. Check the size.');
    });
  });
});
