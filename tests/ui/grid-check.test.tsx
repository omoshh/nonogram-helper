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
afterEach(cleanup);

const mount = (p: Partial<Parameters<typeof GridCheck>[0]> = {}) => {
  const onConfirm = vi.fn(), onCancel = vi.fn();
  render(<GridCheck file={file} onConfirm={onConfirm} onCancel={onCancel} {...p} />);
  return { onConfirm, onCancel };
};
const use = () => screen.getByRole('button', { name: 'Use this grid' }) as HTMLButtonElement;
const drag = (name: string, x: number, y: number) => {
  const h = screen.getByLabelText(name);
  fireEvent.pointerDown(h, { pointerId: 1, clientX: 0, clientY: 0 });
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

test('a rejecting re-mesh shows the crossed message instead of crashing', async () => {
  mount();
  await waitFor(() => expect(use().disabled).toBe(false));
  meshFromCornersAsync.mockRejectedValue(new Error('degenerate'));
  fireEvent.change(screen.getByLabelText('Size'), { target: { value: '20x15' } });
  await screen.findByText('The corners are crossed.');
  expect(use().disabled).toBe(true);
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
});
