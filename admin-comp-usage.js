window.createAdminCompUsage = function ({
  rpc,
  allowed,
  refreshWork,
  employeeName,
  escapeHtml
}) {
  const panel = document.getElementById('adminCompUsage');
  const $ = id => panel?.querySelector(`#${id}`) || document.getElementById(id);

  const form = $('adminCompUsageForm');
  const button = $('adminCompUsageSubmit');

  let employeeId = null;
  let remaining = 0;
  let busy = false;
  let generation = 0;
  let retry = null;
  let rows = [];

  const now = new Date();
  const dateInput = $('adminCompUsageDate');

  if (dateInput) {
    dateInput.value =
      `${now.getFullYear()}-` +
      `${String(now.getMonth() + 1).padStart(2, '0')}-` +
      `${String(now.getDate()).padStart(2, '0')}`;
  }

  function clear() {
    generation++;
    employeeId = null;
    rows = [];
    remaining = 0;

    if (panel) {
      panel.hidden = true;
    }

    if (button) {
      button.disabled = true;
    }

    const history = $('adminCompUsageHistory');

    if (history) {
      history.replaceChildren();
    }
  }

  async function refresh(id, records) {
    const token = ++generation;

    employeeId = Number(id) || null;

    if (!employeeId) {
      clear();
      return;
    }

    remaining = 0; // Disable submission until authoritative availability arrives.

    const summary = document.querySelector(
      '#workSummary .work-history-summary, #workList .work-history-summary'
    );

    if (!summary) {
      clear();
      return;
    }

    if (panel) {
      if (!panel.closest?.('.work-disclosure')) {
        summary.insertAdjacentElement('afterend', panel);
      }
      panel.hidden = false;
    }

    if (button) {
      button.disabled =
        busy ||
        !allowed() ||
        remaining <= 0;
    }

    const history = $('adminCompUsageHistory');

    if (history) {
      history.replaceChildren();
    }

    try {
      const [historyRows, balances] = await Promise.all([
        rpc('admin_comp_leave_usage_history', { p_employee_id: employeeId }),
        rpc('get_comp_leave_availability', { p_employee_id: employeeId })
      ]);

      if (token !== generation) {
        return;
      }

      remaining = balances.reduce((sum, row) => sum + Number(row.available_days), 0);
      rows = historyRows;
      const daysInput = $('adminCompUsageDays');
      if (daysInput) daysInput.max = String(remaining);
      const balanceMessage = $('adminCompUsageMessage');
      if (balanceMessage && !busy) balanceMessage.textContent = `使用可能 ${remaining}日（提出済みの予約分を除く）`;
      if (button) button.disabled = busy || !allowed() || remaining <= 0;
      const currentHistory = $('adminCompUsageHistory');

      if (!currentHistory) {
        return;
      }

      currentHistory.innerHTML = historyRows.length
        ? historyRows
            .map(
              row => `
                <article class="application-item history-card">
                  <div class="application-item-head">
                    <h3>
                      ${escapeHtml(row.usage_date)}
                      ／
                      ${Number(row.days)}日
                    </h3>

                    <span class="status approved">
                      管理者直接登録${
                        row.status === 'approved'
                          ? ''
                          : '（取消）'
                      }
                    </span>
                  </div>

                  <p>
                    対象社員：
                    ${escapeHtml(
                      employeeName(row.employee_id)
                    )}
                    <br>

                    登録者：
                    ${escapeHtml(
                      employeeName(
                        row.created_by_employee_id
                      )
                    )}
                    （ID：${row.created_by_employee_id}）
                    <br>

                    備考：
                    ${escapeHtml(row.note || '-')}
                    <br>

                    登録日時：
                    ${escapeHtml(
                      new Date(
                        row.created_at
                      ).toLocaleString('ja-JP')
                    )}
                  </p>
                  ${allowed() && row.status === 'approved' ? `
                    <div class="record-actions">
                      <button type="button" class="secondary" data-comp-action="edit" data-id="${Number(row.id)}">修正</button>
                      <button type="button" class="danger" data-comp-action="delete" data-id="${Number(row.id)}">削除</button>
                    </div>
                    <div data-comp-editor hidden></div>
                    <p class="message" role="status" data-comp-message></p>
                  ` : ''}
                </article>
              `
            )
            .join('')
        : '<p class="empty">管理者直接登録の代休使用履歴はありません</p>';
    } catch (error) {
      if (token !== generation) {
        return;
      }

      const currentHistory = $('adminCompUsageHistory');

      if (currentHistory) {
        currentHistory.textContent =
          `履歴を取得できませんでした：${error.message}`;
      }
    }
  }

  const history = $('adminCompUsageHistory');
  history?.addEventListener('click', async event => {
    const actionButton = event.target.closest('[data-comp-action]');
    if (!actionButton || busy || !allowed() || !employeeId) return;
    const row = rows.find(item => Number(item.id) === Number(actionButton.dataset.id));
    if (!row || row.status !== 'approved' || Number(row.employee_id) !== employeeId) return;
    const card = actionButton.closest('article');
    const editor = card.querySelector('[data-comp-editor]');
    const message = card.querySelector('[data-comp-message]');
    const action = actionButton.dataset.compAction;
    if (action === 'edit') {
      editor.innerHTML = `
        <div class="field"><label>代休使用日<input data-comp-date type="date" required value="${escapeHtml(row.usage_date)}"></label></div>
        <div class="field"><label>使用日数<input data-comp-days type="number" min="0.01" max="9999.99" step="0.01" required value="${Number(row.days)}"></label></div>
        <div class="field"><label>備考<textarea data-comp-note rows="3">${escapeHtml(row.note || '')}</textarea></label></div>
        <div class="record-actions">
          <button type="button" class="primary" data-comp-action="save" data-id="${Number(row.id)}">保存</button>
          <button type="button" class="secondary" data-comp-action="cancel" data-id="${Number(row.id)}">キャンセル</button>
        </div>`;
      editor.hidden = false;
      card.querySelector('.record-actions').hidden = true;
      editor.querySelector('input').focus();
      message.textContent = '';
      return;
    }
    if (action === 'cancel') {
      editor.hidden = true;
      card.querySelector('.record-actions').hidden = false;
      message.textContent = '';
      return;
    }
    const payload = { p_application_id: Number(row.id), p_employee_id: employeeId };
    if (action === 'save') {
      const inputs = [...editor.querySelectorAll('input')];
      if (!inputs.every(input => input.reportValidity())) return;
      payload.p_usage_date = editor.querySelector('[data-comp-date]').value;
      payload.p_days = Number(editor.querySelector('[data-comp-days]').value);
      payload.p_note = editor.querySelector('[data-comp-note]').value.trim() || null;
    } else if (action === 'delete') {
      if (!window.confirm('この代休使用履歴を削除しますか？\n使用済み日数は代休残数へ戻ります。ただし、有効期限を過ぎた分は使用できません。')) return;
    } else return;
    busy = true;
    const token = generation;
    const controls = [...history.querySelectorAll('button, input, textarea'), button].filter(Boolean);
    const states = controls.map(control => control.disabled);
    controls.forEach(control => { control.disabled = true; });
    message.textContent = action === 'save' ? '保存しています…' : '削除しています…';
    try {
      await rpc(action === 'save' ? 'update_admin_comp_leave_usage' : 'delete_admin_comp_leave_usage', payload);
      if (token === generation) {
        message.textContent = action === 'save' ? '保存しました' : '削除しました';
        try { await refreshWork(); }
        catch (error) {
          $('adminCompUsageHistory').textContent = `処理は完了しましたが一覧更新に失敗しました。対象社員を選び直してください：${error.message}`;
        }
      }
    } catch (error) {
      if (token === generation) message.textContent = `処理できませんでした：${error.message}`;
    } finally {
      controls.forEach((control, index) => { control.disabled = states[index]; });
      busy = false;
      if (button) button.disabled = !employeeId || !allowed() || remaining <= 0;
    }
  });

  if (form) {
    form.addEventListener(
      'submit',
      async event => {
        event.preventDefault();

        if (
          busy ||
          !form.reportValidity()
        ) {
          return;
        }

        const message = $(
          'adminCompUsageMessage'
        );

        const days = Number(
          $('adminCompUsageDays')?.value
        );

        if (
          !allowed() ||
          !employeeId
        ) {
          if (message) {
            message.textContent =
              '対象社員と残数管理権限を確認してください';
          }

          return;
        }

        if (
          !Number.isFinite(days) ||
          days <= 0 ||
          days > remaining
        ) {
          if (message) {
            message.textContent =
              '使用日数は0より大きく、代休残日数以下にしてください';
          }

          return;
        }

        const usageDate =
          $('adminCompUsageDate')?.value;

        const note =
          $('adminCompUsageNote')
            ?.value
            .trim() || null;

        const payload = {
          p_employee_id: employeeId,
          p_usage_date: usageDate,
          p_days: days,
          p_note: note
        };

        const fingerprint =
          JSON.stringify(payload);

        if (
          !retry ||
          retry.fingerprint !== fingerprint
        ) {
          retry = {
            fingerprint,
            id: crypto.randomUUID()
          };
        }

        busy = true;

        const controls = [
          ...form.elements,
          $('workEmployee'),
          $('workDepartment')
        ].filter(Boolean);

        const states = controls.map(
          control => control.disabled
        );

        controls.forEach(
          control => {
            control.disabled = true;
          }
        );

        if (message) {
          message.textContent =
            '登録しています…';
        }

        try {
          await rpc(
            'register_admin_comp_leave_usage',
            {
              ...payload,
              p_request_id: retry.id
            }
          );

          retry = null;

          const noteInput =
            $('adminCompUsageNote');

          if (noteInput) {
            noteInput.value = '';
          }

          if (message) {
            message.textContent =
              '代休使用を登録しました';
          }

          try {
            await refreshWork();
          } catch (error) {
            remaining = 0;

            const workList =
              document.getElementById(
                'workList'
              );

            if (
              workList &&
              panel
            ) {
              if (!panel.closest?.('.work-disclosure')) {
                workList.appendChild(panel);
              }
              panel.hidden = false;
            }

            if (message) {
              message.textContent +=
                `。一覧更新に失敗しました。再登録せず再表示してください：${error.message}`;
            }
          }
        } catch (error) {
          if (message) {
            message.textContent =
              `登録できませんでした：${error.message}`;
          }
        } finally {
          controls.forEach(
            (control, index) => {
              control.disabled =
                states[index];
            }
          );

          busy = false;

          if (button) {
            button.disabled =
              !employeeId ||
              !allowed() ||
              remaining <= 0;
          }
        }
      }
    );
  }

  return {
    clear,
    refresh
  };
};
