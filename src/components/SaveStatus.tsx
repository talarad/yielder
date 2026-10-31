import { useMutation, useQueryClient } from '@tanstack/react-query';

import { reconnect, reloadFromStorage, useSaveStatus, workspace } from '../data/workspace';
import { useI18n } from '../i18n';
import { Icon } from './ui';

/** Signs in to Google again and refreshes everything shown (from a click). */
function useReconnect() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      await reconnect();
      await qc.invalidateQueries();
    },
  });
}

/** Quiet line under the navigation: "Saved to Google Drive" / "Saving…" / "Copy on this device". */
export function SaveLine() {
  const { t } = useI18n();
  const { state } = useSaveStatus();
  const connect = useReconnect();
  let kind: 'drive' | 'browser' = 'browser';

  try {
    kind = workspace().backend.kind;
  } catch {
    return null;
  }

  if (state === 'offline') {
    return (
      <div className="save-line offline" role="status" title={t('save.offlineHint')}>
        <span className="dot" aria-hidden="true" />
        {t('save.offline')} ·{' '}
        <button className="link-btn" onClick={() => connect.mutate()} disabled={connect.isPending}>
          {t('save.connect')}
        </button>
      </div>
    );
  }

  const text = state === 'saved' ? t(kind === 'drive' ? 'save.savedDrive' : 'save.savedBrowser') : state === 'saving' || state === 'pending' ? t('save.saving') : t('save.notSaved');

  return (
    <div className={`save-line ${state}`} role="status">
      <span className="dot" aria-hidden="true" />
      {text}
    </div>
  );
}

/** On phones (no sidebar): the same "copy on this device" note, above the page. */
export function OfflineNote() {
  const { t, errorText } = useI18n();
  const { state } = useSaveStatus();
  const connect = useReconnect();

  if (state !== 'offline') {
    return null;
  }

  return (
    <div className="notice info offline-note" role="status">
      <Icon name="alert" size={18} />
      <div className="stack" style={{ gap: 6 }}>
        <span>{t('save.offlineHint')}</span>
        <div>
          <button className="btn small" onClick={() => connect.mutate()} disabled={connect.isPending}>
            {t('save.connect')}
          </button>
        </div>
        {connect.error && <span className="small">{errorText(connect.error)}</span>}
      </div>
    </div>
  );
}

/** When the last change couldn't be saved: what happened and the one button that fixes it. */
export function SaveProblem() {
  const { t, errorText } = useI18n();
  const qc = useQueryClient();
  const { state, error } = useSaveStatus();
  const fix = useMutation({
    mutationFn: async (action: 'retry' | 'reconnect' | 'reload' | 'keep') => {
      if (action === 'reload') {
        await reloadFromStorage();
        await qc.invalidateQueries();

        return;
      }

      if (action === 'reconnect') {
        await reconnect();

        return;
      }

      await workspace().save({ force: action === 'keep' });
    },
  });

  if (state !== 'error' && state !== 'conflict' && state !== 'reauth') {
    return null;
  }

  return (
    <div className="notice error save-problem" role="alert">
      <Icon name="alert" size={20} />
      <div className="stack" style={{ gap: 8 }}>
        <span>{state === 'conflict' ? t('save.conflict') : state === 'reauth' ? t('save.reauth') : t('save.failed')}</span>
        <div className="row" style={{ gap: 8 }}>
          {state === 'conflict' ? (
            <>
              <button className="btn small primary" onClick={() => fix.mutate('reload')} disabled={fix.isPending}>
                {t('save.loadLatest')}
              </button>
              <button className="btn small" onClick={() => fix.mutate('keep')} disabled={fix.isPending}>
                {t('save.keepMine')}
              </button>
            </>
          ) : (
            <button className="btn small primary" onClick={() => fix.mutate(state === 'reauth' ? 'reconnect' : 'retry')} disabled={fix.isPending}>
              {state === 'reauth' ? t('save.reconnect') : t('save.retry')}
            </button>
          )}
        </div>
        {(fix.error || state === 'error') && <span className="small">{errorText(fix.error ?? error)}</span>}
      </div>
    </div>
  );
}
