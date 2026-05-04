import { useState } from 'react';
import {
  Typography, DatePicker, Select, Button, Table, Tag, Space,
  Spin, Alert, Popconfirm, message, Row, Col, Card, Statistic,
} from 'antd';
import { DownloadOutlined, CheckOutlined, CloseOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs, { type Dayjs } from 'dayjs';
import { api, type TardinessRecord, type User } from '../api/client';

const { Title } = Typography;
const { RangePicker } = DatePicker;

const STATUS_TAG: Record<string, { color: string; label: string }> = {
  NONE:     { color: 'default',  label: 'Без причины' },
  PENDING:  { color: 'orange',   label: 'Ожидает' },
  ACCEPTED: { color: 'green',    label: 'Принята' },
  REJECTED: { color: 'red',      label: 'Отклонена' },
};

export default function ReportPage() {
  const qc = useQueryClient();
  const [messageApi, contextHolder] = message.useMessage();

  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs]>([
    dayjs().startOf('month'),
    dayjs(),
  ]);
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);

  const { data: users } = useQuery({ queryKey: ['users'], queryFn: api.getUsers });

  const { data: records, isLoading, isError } = useQuery({
    queryKey: ['report', dateRange, selectedUsers],
    queryFn: () =>
      api.getReport({
        dateFrom: dateRange[0].format('YYYY-MM-DD'),
        dateTo: dateRange[1].format('YYYY-MM-DD'),
        userIds: selectedUsers,
      }),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'ACCEPTED' | 'REJECTED' }) =>
      api.updateReasonStatus(id, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['report'] });
      messageApi.success('Статус обновлён');
    },
    onError: (err: Error) => messageApi.error(err.message),
  });

  const userMap = Object.fromEntries((users ?? []).map((u: User) => [u.id, u.name]));
  const userOptions = (users ?? []).map((u: User) => ({ value: u.id, label: u.name }));

  // Группировка записей по сотруднику
  const grouped = groupByUser(records ?? [], userMap);

  const totalLate = (records ?? []).filter((r) => r.reasonStatus !== 'ACCEPTED').length;

  function handleExport() {
    const url = api.getExportUrl({
      dateFrom: dateRange[0].format('YYYY-MM-DD'),
      dateTo: dateRange[1].format('YYYY-MM-DD'),
      userIds: selectedUsers,
    });
    window.open(url, '_blank');
  }

  const columns = [
    {
      title: 'Дата',
      dataIndex: 'date',
      key: 'date',
      render: (v: string) => dayjs(v).format('DD.MM.YYYY'),
      width: 110,
    },
    {
      title: 'Плановое',
      dataIndex: 'planStart',
      key: 'planStart',
      render: (v: string) => dayjs(v).format('HH:mm'),
      width: 90,
    },
    {
      title: 'Фактическое',
      dataIndex: 'actualStart',
      key: 'actualStart',
      render: (v: string) => dayjs(v).format('HH:mm'),
      width: 110,
    },
    {
      title: 'Опоздание',
      dataIndex: 'lateMinutes',
      key: 'lateMinutes',
      render: (v: number) => <Tag color="volcano">{v} мин</Tag>,
      width: 100,
    },
    {
      title: 'Причина',
      dataIndex: 'reason',
      key: 'reason',
      render: (v: string) => v || <span style={{ color: '#ccc' }}>—</span>,
    },
    {
      title: 'Статус',
      dataIndex: 'reasonStatus',
      key: 'reasonStatus',
      render: (v: string) => {
        const s = STATUS_TAG[v] ?? STATUS_TAG.NONE;
        return <Tag color={s.color}>{s.label}</Tag>;
      },
      width: 110,
    },
    {
      title: 'Действия',
      key: 'actions',
      width: 120,
      render: (_: unknown, rec: TardinessRecord) => {
        if (rec.reasonStatus !== 'PENDING') return null;
        return (
          <Space>
            <Popconfirm
              title="Принять причину?"
              onConfirm={() => statusMutation.mutate({ id: rec.id, status: 'ACCEPTED' })}
            >
              <Button
                size="small"
                type="primary"
                icon={<CheckOutlined />}
                loading={statusMutation.isPending}
              />
            </Popconfirm>
            <Popconfirm
              title="Отклонить причину?"
              onConfirm={() => statusMutation.mutate({ id: rec.id, status: 'REJECTED' })}
            >
              <Button
                size="small"
                danger
                icon={<CloseOutlined />}
                loading={statusMutation.isPending}
              />
            </Popconfirm>
          </Space>
        );
      },
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      {contextHolder}
      <Title level={3} style={{ marginBottom: 20 }}>Отчёт по опозданиям</Title>

      {/* Фильтры */}
      <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
        <Col>
          <RangePicker
            value={dateRange}
            onChange={(v) => v && setDateRange(v as [Dayjs, Dayjs])}
            format="DD.MM.YYYY"
            allowClear={false}
          />
        </Col>
        <Col flex="300px">
          <Select
            mode="multiple"
            placeholder="Все сотрудники"
            options={userOptions}
            value={selectedUsers}
            onChange={setSelectedUsers}
            style={{ width: '100%' }}
            allowClear
            filterOption={(input, opt) =>
              (opt?.label ?? '').toLowerCase().includes(input.toLowerCase())
            }
          />
        </Col>
        <Col>
          <Button icon={<DownloadOutlined />} onClick={handleExport}>
            Экспорт Excel
          </Button>
        </Col>
      </Row>

      {/* Итого */}
      <Row gutter={16} style={{ marginBottom: 20 }}>
        <Col>
          <Card size="small">
            <Statistic title="Опозданий (незачтённых)" value={totalLate} />
          </Card>
        </Col>
        <Col>
          <Card size="small">
            <Statistic title="Сотрудников в выборке" value={grouped.length} />
          </Card>
        </Col>
      </Row>

      {/* Ошибка */}
      {isError && <Alert type="error" message="Не удалось загрузить данные" style={{ marginBottom: 16 }} />}

      {/* Таблица по каждому сотруднику */}
      {isLoading ? (
        <div style={{ textAlign: 'center', padding: 40 }}><Spin size="large" /></div>
      ) : (
        grouped.map(({ userId, userName, records: userRecords }) => (
          <Card
            key={userId}
            title={
              <Space>
                <span>{userName}</span>
                <Tag color="blue">{userRecords.length} оп.</Tag>
              </Space>
            }
            style={{ marginBottom: 16 }}
            size="small"
          >
            <Table
              dataSource={userRecords}
              columns={columns}
              rowKey="id"
              pagination={false}
              size="small"
            />
          </Card>
        ))
      )}
    </div>
  );
}

function groupByUser(records: TardinessRecord[], userMap: Record<string, string>) {
  const map = new Map<string, TardinessRecord[]>();
  for (const r of records) {
    if (!map.has(r.userId)) map.set(r.userId, []);
    map.get(r.userId)!.push(r);
  }
  return Array.from(map.entries()).map(([userId, recs]) => ({
    userId,
    userName: userMap[userId] || `ID ${userId}`,
    records: recs.sort((a, b) => (a.date < b.date ? -1 : 1)),
  }));
}
