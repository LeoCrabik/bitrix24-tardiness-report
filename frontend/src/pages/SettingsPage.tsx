import { useState } from 'react';
import {
  Card, Form, Select, InputNumber, Switch, TimePicker, Button,
  Typography, Space, Row, Col, Spin, Alert, message,
} from 'antd';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { api, type Settings } from '../api/client';

const { Title, Text } = Typography;

const DAYS: { key: string; label: string }[] = [
  { key: '1', label: 'Понедельник' },
  { key: '2', label: 'Вторник' },
  { key: '3', label: 'Среда' },
  { key: '4', label: 'Четверг' },
  { key: '5', label: 'Пятница' },
  { key: '6', label: 'Суббота' },
  { key: '7', label: 'Воскресенье' },
];

interface Props { userId: string }

export default function SettingsPage({ userId: _userId }: Props) {
  const qc = useQueryClient();
  const [messageApi, contextHolder] = message.useMessage();

  const { data: users, isLoading: usersLoading } = useQuery({
    queryKey: ['users'],
    queryFn: api.getUsers,
  });

  const { data: settings, isLoading: settingsLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: api.getSettings,
  });

  const mutation = useMutation({
    mutationFn: api.saveSettings,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      messageApi.success('Настройки сохранены');
    },
    onError: (err: Error) => messageApi.error(err.message),
  });

  const [schedule, setSchedule] = useState<Settings['schedule']>(() =>
    settings?.schedule ?? {},
  );

  if (usersLoading || settingsLoading) {
    return <div style={{ padding: 24, textAlign: 'center' }}><Spin size="large" /></div>;
  }

  if (!settings) {
    return <Alert type="error" message="Не удалось загрузить настройки" />;
  }

  const currentSchedule = Object.keys(schedule).length ? schedule : settings.schedule;

  const userOptions = (users ?? []).map((u) => ({ value: u.id, label: u.name }));

  function onFinish(values: {
    trackedUsers: string[];
    managers: string[];
    lateThreshold: number;
  }) {
    mutation.mutate({
      trackedUsers: values.trackedUsers,
      managers: values.managers,
      lateThreshold: values.lateThreshold,
      schedule: currentSchedule,
    });
  }

  function updateDay(key: string, field: 'enabled' | 'start' | 'end', val: boolean | string) {
    setSchedule((prev) => ({
      ...prev,
      [key]: { ...((prev[key] ?? settings!.schedule[key]) || { enabled: true, start: '09:00', end: '18:00' }), [field]: val },
    }));
  }

  return (
    <div style={{ padding: 24, maxWidth: 800 }}>
      {contextHolder}
      <Title level={3} style={{ marginBottom: 24 }}>Настройки приложения</Title>

      <Form
        layout="vertical"
        initialValues={{
          trackedUsers: settings.trackedUsers,
          managers: settings.managers,
          lateThreshold: settings.lateThreshold,
        }}
        onFinish={onFinish}
      >
        <Card title="Сотрудники" style={{ marginBottom: 16 }}>
          <Form.Item label="Отслеживаемые сотрудники" name="trackedUsers">
            <Select
              mode="multiple"
              options={userOptions}
              placeholder="Выберите сотрудников"
              filterOption={(input, opt) =>
                (opt?.label ?? '').toLowerCase().includes(input.toLowerCase())
              }
              allowClear
            />
          </Form.Item>

          <Form.Item label="Руководители" name="managers">
            <Select
              mode="multiple"
              options={userOptions}
              placeholder="Выберите руководителей"
              filterOption={(input, opt) =>
                (opt?.label ?? '').toLowerCase().includes(input.toLowerCase())
              }
              allowClear
            />
          </Form.Item>
        </Card>

        <Card title="Параметры опоздания" style={{ marginBottom: 16 }}>
          <Form.Item
            label="Порог опоздания (минут)"
            name="lateThreshold"
            rules={[{ required: true }]}
          >
            <InputNumber min={1} max={120} style={{ width: 160 }} />
          </Form.Item>
        </Card>

        <Card title="Рабочий график" style={{ marginBottom: 24 }}>
          <Space direction="vertical" style={{ width: '100%' }}>
            {DAYS.map(({ key, label }) => {
              const day = currentSchedule[key] ?? { enabled: false, start: '09:00', end: '18:00' };
              return (
                <Row key={key} align="middle" gutter={16}>
                  <Col style={{ width: 140 }}>
                    <Switch
                      checked={day.enabled}
                      onChange={(v) => updateDay(key, 'enabled', v)}
                      checkedChildren="Рабочий"
                      unCheckedChildren="Выходной"
                    />
                  </Col>
                  <Col style={{ width: 120 }}>
                    <Text>{label}</Text>
                  </Col>
                  <Col>
                    <TimePicker
                      disabled={!day.enabled}
                      value={dayjs(day.start, 'HH:mm')}
                      format="HH:mm"
                      onChange={(t) => t && updateDay(key, 'start', t.format('HH:mm'))}
                      minuteStep={15}
                    />
                  </Col>
                  <Col><Text type="secondary">—</Text></Col>
                  <Col>
                    <TimePicker
                      disabled={!day.enabled}
                      value={dayjs(day.end, 'HH:mm')}
                      format="HH:mm"
                      onChange={(t) => t && updateDay(key, 'end', t.format('HH:mm'))}
                      minuteStep={15}
                    />
                  </Col>
                </Row>
              );
            })}
          </Space>
        </Card>

        <Button type="primary" htmlType="submit" loading={mutation.isPending} size="large">
          Сохранить настройки
        </Button>
      </Form>
    </div>
  );
}
