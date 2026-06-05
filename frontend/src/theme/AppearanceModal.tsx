import { Modal } from "../components/ui";
import AppearanceControls from "./AppearanceControls";
import { useTheme } from "./ThemeContext";

/** Personal appearance settings — applies live and persists per browser. */
export default function AppearanceModal({ onClose }: { onClose: () => void }) {
  const theme = useTheme();
  return (
    <Modal title="Appearance" onClose={onClose} maxWidth={460}>
      <p className="muted -mt-1 mb-4 text-sm">
        Personalize how the app looks for you. Changes apply instantly and are
        remembered on this device.
      </p>
      <AppearanceControls value={theme} onChange={theme.setField} />
      {theme.hasOverride && (
        <div className="mt-5 flex justify-end">
          <button className="btn-sm" onClick={theme.resetToOrgDefault}>
            Reset to company default
          </button>
        </div>
      )}
    </Modal>
  );
}
