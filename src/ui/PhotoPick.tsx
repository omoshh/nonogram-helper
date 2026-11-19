export function PhotoPick(props: { label: string; onFile: (f: File) => void }) {
  return (
    <label class="photo-pick">
      <span class="button primary">{props.label}</span>
      <input type="file" accept="image/*" capture="environment" hidden
        onChange={(e) => {
          const el = e.target as HTMLInputElement;
          const f = el.files?.[0];
          el.value = '';
          if (f) props.onFile(f);
        }} />
    </label>
  );
}
