const ExcelJS = require('exceljs');

async function generateExcel(records, users) {
  const userMap = Object.fromEntries(users.map((u) => [u.id, u.name]));

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Опоздания');

  sheet.columns = [
    { header: 'Сотрудник', key: 'userName', width: 30 },
    { header: 'Дата', key: 'date', width: 14 },
    { header: 'Плановое время', key: 'planStart', width: 18 },
    { header: 'Фактическое время', key: 'actualStart', width: 18 },
    { header: 'Опоздание (мин)', key: 'lateMinutes', width: 16 },
    { header: 'Причина', key: 'reason', width: 40 },
    { header: 'Статус причины', key: 'reasonStatus', width: 18 },
  ];

  // Стиль заголовка
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };
  headerRow.alignment = { horizontal: 'center' };

  // Сортировка: сначала по имени, потом по дате
  const sorted = [...records].sort((a, b) => {
    const nameA = userMap[a.userId] || '';
    const nameB = userMap[b.userId] || '';
    if (nameA !== nameB) return nameA.localeCompare(nameB, 'ru');
    return a.date < b.date ? -1 : 1;
  });

  for (const rec of sorted) {
    sheet.addRow({
      userName: userMap[rec.userId] || `ID ${rec.userId}`,
      date: formatDate(rec.date),
      planStart: formatTime(rec.planStart),
      actualStart: formatTime(rec.actualStart),
      lateMinutes: rec.lateMinutes,
      reason: rec.reason || '',
      reasonStatus: translateStatus(rec.reasonStatus),
    });
  }

  // Автофильтр
  sheet.autoFilter = { from: 'A1', to: 'G1' };

  return workbook.xlsx.writeBuffer();
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('ru-RU');
}

function formatTime(dateTimeStr) {
  if (!dateTimeStr) return '';
  const d = new Date(dateTimeStr);
  return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function translateStatus(status) {
  const map = { NONE: 'Нет причины', PENDING: 'Ожидает', ACCEPTED: 'Принята', REJECTED: 'Отклонена' };
  return map[status] || status;
}

module.exports = { generateExcel };
