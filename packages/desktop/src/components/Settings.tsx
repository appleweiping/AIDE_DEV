import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '../stores/settings';
import { testProvider } from '../lib/api';
import { PROVIDER_PRESETS } from '@aide/shared';
import type { PermissionMode } from '@aide/shared';

interface Props {
  onClose: () => void;
}

type TestStatus = { state: 'idle' | 'testing' | 'ok' | 'failed'; detail?: string };

const input =
  'w-full rounded border border-[#3e3e42] bg-[#2d2d30] px-3 py-1.5 text-sm text-[#cccccc] placeholder-[#6b6b6b] outline-none focus:border-[#0e639c]';
const label = 'mb-1 block text-xs text-[#9d9d9d]';

export default function Settings({ onClose }: Props) {
  const { t, i18n } = useTranslation();
  const settings = useSettingsStore();

  // Local form state, committed on Save
  const [providerId, setProviderId] = useState(settings.provider.id);
  const [apiKey, setApiKey] = useState(settings.provider.apiKey);
  const [model, setModel] = useState(settings.provider.model);
  const [baseUrl, setBaseUrl] = useState(settings.provider.baseUrl);
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(settings.permissionMode);
  const [thinkingEnabled, setThinkingEnabled] = useState(settings.thinkingEnabled);
  const [maxIterations, setMaxIterations] = useState(settings.maxIterations);
  const [workingDirectory, setWorkingDirectory] = useState(settings.workingDirectory);
  const [language, setLanguage] = useState(settings.language);
  const [test, setTest] = useState<TestStatus>({ state: 'idle' });
  const [saved, setSaved] = useState(false);

  const preset = PROVIDER_PRESETS.find((p) => p.id === providerId);

  function handleProviderChange(id: string) {
    setProviderId(id);
    const p = PROVIDER_PRESETS.find((x) => x.id === id);
    if (p) {
      setBaseUrl(p.baseUrl);
      setModel(p.models[0].id);
    }
  }

  async function handleTest() {
    setTest({ state: 'testing' });
    try {
      const r = await testProvider({ id: providerId, name: preset?.name ?? providerId, baseUrl, apiKey, model });
      setTest(r.ok ? { state: 'ok' } : { state: 'failed', detail: r.error });
    } catch (err) {
      setTest({ state: 'failed', detail: err instanceof Error ? err.message : String(err) });
    }
  }

  function handleSave() {
    settings.setProvider({ id: providerId, apiKey, model, baseUrl });
    settings.setPermissionMode(permissionMode);
    settings.setThinkingEnabled(thinkingEnabled);
    settings.setMaxIterations(maxIterations);
    settings.setWorkingDirectory(workingDirectory.trim());
    settings.setLanguage(language);
    i18n.changeLanguage(language);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
    >
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-lg border border-[#3e3e42] bg-[#252526] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#3e3e42] px-4 py-3">
          <h2 id="settings-title" className="text-sm font-semibold text-[#cccccc]">
            {t('settings.title')}
          </h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-[#9d9d9d] hover:bg-[#2a2d2e] hover:text-[#cccccc]"
            aria-label={t('settings.close')}
          >
            ✕
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
          <section className="space-y-3">
            <div>
              <label className={label}>{t('settings.workingDirectory')}</label>
              <input
                className={input}
                value={workingDirectory}
                onChange={(e) => setWorkingDirectory(e.target.value)}
                placeholder={t('settings.workingDirectoryHint')}
              />
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[#6b6b6b]">{t('settings.provider')}</h3>
            <div>
              <label className={label}>{t('settings.provider')}</label>
              <select className={input} value={providerId} onChange={(e) => handleProviderChange(e.target.value)}>
                {PROVIDER_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nameZh} ({p.name})
                  </option>
                ))}
                <option value="custom">{t('settings.customProvider')}</option>
              </select>
            </div>
            <div>
              <label className={label}>{t('settings.model')}</label>
              <input className={input} list="model-options" value={model} onChange={(e) => setModel(e.target.value)} />
              <datalist id="model-options">
                {preset?.models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </datalist>
            </div>
            <div>
              <label className={label}>{t('settings.baseUrl')}</label>
              <input className={input} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
            </div>
            <div>
              <label className={label}>{t('settings.apiKey')}</label>
              <input
                className={input}
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={t('settings.apiKeyPlaceholder')}
              />
            </div>
            <button
              onClick={handleTest}
              disabled={test.state === 'testing' || !apiKey || !baseUrl || !model}
              className={`rounded px-3 py-1.5 text-sm disabled:opacity-50 ${
                test.state === 'ok'
                  ? 'bg-[#4ec9b0]/20 text-[#4ec9b0]'
                  : test.state === 'failed'
                    ? 'bg-[#f44747]/20 text-[#f44747]'
                    : 'bg-[#2d2d30] text-[#9d9d9d] hover:bg-[#3e3e42] hover:text-[#cccccc]'
              }`}
            >
              {test.state === 'testing'
                ? t('settings.testing')
                : test.state === 'ok'
                  ? t('settings.connectionOk')
                  : test.state === 'failed'
                    ? t('settings.connectionFailed')
                    : t('settings.testConnection')}
            </button>
            {test.detail && <p className="break-all text-xs text-[#f44747]">{test.detail}</p>}
          </section>

          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[#6b6b6b]">{t('settings.agent')}</h3>
            <div>
              <label className={label}>{t('settings.permissionMode')}</label>
              <select
                className={input}
                value={permissionMode}
                onChange={(e) => setPermissionMode(e.target.value as PermissionMode)}
              >
                <option value="safe">{t('settings.permissionSafe')}</option>
                <option value="trusted">{t('settings.permissionTrusted')}</option>
                <option value="locked">{t('settings.permissionLocked')}</option>
              </select>
            </div>
            <div>
              <label className={label}>{t('settings.maxIterations')}</label>
              <input
                className={input}
                type="number"
                min={1}
                max={200}
                value={maxIterations}
                onChange={(e) => setMaxIterations(Number(e.target.value))}
              />
            </div>
            {preset?.supportsThinking && (
              <label className="flex items-center gap-2 text-xs text-[#9d9d9d]">
                <input type="checkbox" checked={thinkingEnabled} onChange={(e) => setThinkingEnabled(e.target.checked)} />
                {t('settings.thinking')}
              </label>
            )}
            <div>
              <label className={label}>{t('settings.language')}</label>
              <select className={input} value={language} onChange={(e) => setLanguage(e.target.value as 'en' | 'zh-CN')}>
                <option value="zh-CN">中文</option>
                <option value="en">English</option>
              </select>
            </div>
          </section>
          <p className="text-xs text-[#6b6b6b]">{t('settings.keyStorage')}</p>
        </div>

        <div className="flex justify-end gap-2 border-t border-[#3e3e42] px-4 py-3">
          <button
            onClick={onClose}
            className="rounded border border-[#3e3e42] px-4 py-1.5 text-sm text-[#cccccc] hover:bg-[#2a2d2e]"
          >
            {t('settings.close')}
          </button>
          <button
            onClick={handleSave}
            className={`rounded px-4 py-1.5 text-sm text-white ${saved ? 'bg-[#4ec9b0]' : 'bg-[#0e639c] hover:bg-[#1177bb]'}`}
          >
            {saved ? t('settings.saved') : t('settings.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
