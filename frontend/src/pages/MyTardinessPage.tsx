import { useState } from 'react';
import {
  Typography, DatePicker, Table, Tag, Button, Input,
  Space, Spin, Alert, message, Row, Col,
} from 'antd';
import { SendOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs, { type Dayjs } from 'dayjs';
import { api, type TardinessRecord } from '../api/client';

const { Title } = Typography;
const { RangePicker } = DatePicker;
const { TextArea } = Input;

const STATUS_TAG: Record<string, { color: string; label: string }> = {
  NONE:     { color: 'default', label: 'Нет причины' },
  PENDING:  { color: 'orange',  label: 'Ожидает' },
  ACCEPTED: { color: 'green',   label: 'Принята' },
  REJECTED: { color: 'red',     label: 'Отклонена' },
};

interface Props { userId: string }

export default function MyTardinessPage({ userId: _userId }: Props) {
  const qc = useQueryClient();
  const [messageApi, contextHolder] = message.useMessage();

  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs]>([
    dayjs().startOf('month'),
    dayjs(),
  ]);
  const [reasons, setReasons] = useState<Record<string, string>>({});

  const { data: records, isLoading, isError } = useQuery({
    queryKey: ['my-tardiness', dateRange],
    queryFn: () =>
      api.getMyTardiness({
        dateFrom: dateRange[0].format('YYYY-MM-DD'),
        dateTo: dateRange[1].format('YYYY-MM-DD'),
      }),
  });

  const reasonMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.submitReason(id, reason),
    onSuccess: (_data, { id }) => {
      setReasons((prev) => ({ ...prev, [id]: '' }));
      qc.invalidateQueries({ queryKey: ['my-tardiness'] });
      messageApi.success('Причина отправлена');
    },
    onError: (err: Error) => messageApi.error(err.message),
  });

  function canSubmitReason(rec: TardinessRecord) {
    return rec.reasonStatus === 'NONE' || rec.reasonStatus === 'REJECTED';
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
      title: 'Причина',
      key: 'reason',
      render: (_: unknown, rec: TardinessRecord) => {
        if (!canSubmitReason(rec)) {
          return <span style={{ color: '#666' }}>{rec.reason || '—'}</span>;
        }
        return (
          <Space direction="vertical" style={{ width: '100%' }}>
            {rec.reason && rec.reasonStatus === 'REJECTED' && (
              <span style={{ color: '#999', fontSize: 12 }}>
                Отклонено: {rec.reason}
              </span>
            )}
            <Space.Compact style={{ width: '100%' }}>
              <TextArea
                autoSize
                placeholder="Укажите причину опоздания..."
                value={reasons[rec.id] ?? ''}
                onChange={(e) =>
                  setReasons((prev) => ({ ...prev, [rec.id]: e.target.value }))
                }
                style={{ minWidth: 240 }}
              />
              <Button
                type="primary"
                icon={<SendOutlined />}
                loading={reasonMutation.isPending}
                disabled={!reasons[rec.id]?.trim()}
                onClick={() =>
                  reasonMutation.mutate({ id: rec.id, reason: reasons[rec.id] })
                }
              />
            </Space.Compact>
          </Space>
        );
      },
    },
  ];

  return (
    <div style={{ padding: 24, maxWidth: 900 }}>
      {contextHolder}
      <Title level={3} style={{ marginBottom: 20 }}>Мои опоздания</Title>

      <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
        <Col>
          <RangePicker
            value={dateRange}
            onChange={(v) => v && setDateRange(v as [Dayjs, Dayjs])}
            format="DD.MM.YYYY"
            allowClear={false}
          />
        </Col>
      </Row>

      {isError && (
        <Alert type="error" message="Не удалось загрузить данные" style={{ marginBottom: 16 }} />
      )}

      {isLoading ? (
        <div style={{ textAlign: 'center', padding: 40 }}><Spin size="large" /></div>
      ) : (
        <Table
          dataSource={records ?? []}
          columns={columns}
          rowKey="id"
          pagination={{ pageSize: 20 }}
          locale={{ emptyText: 'Опозданий не найдено' }}
        />
      )}
    </div>
  );
}
