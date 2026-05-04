import { useEffect, useState } from 'react';
import { Spin, Alert, Tabs } from 'antd';
import { SettingOutlined, FileTextOutlined, UserOutlined } from '@ant-design/icons';
import { api, initBX24, type UserInfo } from './api/client';
import SettingsPage from './pages/SettingsPage';
import ReportPage from './pages/ReportPage';
import MyTardinessPage from './pages/MyTardinessPage';

export default function App() {
  const [me, setMe] = useState<UserInfo | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    initBX24()
      .then(() => api.getMe())
      .then(setMe)
      .catch((err) => setError(err.message));
  }, []);

  if (error) {
    return (
      <div style={{ padding: 24 }}>
        <Alert type="error" message="Ошибка инициализации" description={error} />
      </div>
    );
  }

  if (!me) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}>
        <Spin size="large" />
      </div>
    );
  }

  // Сотрудник — только своя страница, без вкладок
  if (me.role === 'employee') {
    return <MyTardinessPage userId={me.userId} />;
  }

  // Руководитель — отчёт + свои опоздания
  if (me.role === 'manager') {
    return (
      <Tabs
        defaultActiveKey="report"
        style={{ padding: '0 16px' }}
        items={[
          {
            key: 'report',
            label: <span><FileTextOutlined />Отчёт</span>,
            children: <ReportPage />,
          },
          {
            key: 'my',
            label: <span><UserOutlined />Мои опоздания</span>,
            children: <MyTardinessPage userId={me.userId} />,
          },
        ]}
      />
    );
  }

  // Администратор — настройки + отчёт + свои опоздания
  return (
    <Tabs
      defaultActiveKey="settings"
      style={{ padding: '0 16px' }}
      items={[
        {
          key: 'settings',
          label: <span><SettingOutlined />Настройки</span>,
          children: <SettingsPage userId={me.userId} />,
        },
        {
          key: 'report',
          label: <span><FileTextOutlined />Отчёт</span>,
          children: <ReportPage />,
        },
        {
          key: 'my',
          label: <span><UserOutlined />Мои опоздания</span>,
          children: <MyTardinessPage userId={me.userId} />,
        },
      ]}
    />
  );
}
