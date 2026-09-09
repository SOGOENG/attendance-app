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
