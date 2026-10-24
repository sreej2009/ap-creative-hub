import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { FilterBar, PageHeader, Panel, Table } from '../../components/admin/AdminLayout';
import { Button } from '../../components/ui/Button';
import { Alert, Badge, EmptyState, ErrorState, Skeleton } from '../../components/ui/Feedback';
import { Select } from '../../components/ui/Field';
import { Pagination } from '../../components/ui/Pagination';
import { useToast } from '../../components/ui/Toast';
import { useDocumentTitle } from '../../hooks/useStore';
import { api, errorMessage } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import type { PageMeta } from '../../lib/types';

interface NotificationRow {
  id: string;
  event: string;
  channel: 'email' | 'whatsapp';
  recipient: string;
  status: 'sent' | 'failed' | 'skipped';
  reason: string | null;
  subject: string | null;
  order: string | null;
  orderId: string | null;
  createdAt: string;
}

export function Notifications() {
  useDocumentTitle('Notifications');
  const [status, setStatus] = useState('');
  const [channel, setChannel] = useState('');
  const [page, setPage] = useState(1);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin', 'notifications', status, channel, page],
    queryFn: () => api.get<{ items: NotificationRow[]; meta: PageMeta }>('/admin/notifications', { status, channel, page, limit: 30 }),
    placeholderData: keepPreviousData,
  });
  const skipped = data?.items.some((n) => n.status === 'skipped');
  return (
    <>
      <PageHeader title="Notifications" description="Every customer message attempt, with its real outcome." />
      {skipped && (
        <Alert tone="info" className="mb-4" title="“Skipped” means nothing was sent">
          A notification is skipped when no provider is configured (see Settings → Integrations) or the customer has not opted in to WhatsApp.
        </Alert>
      )}
      <FilterBar>
        <Select label="Outcome" value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))}>
          <option value="">All</option>
          <option value="sent">Sent</option>
          <option value="failed">Failed</option>
          <option value="skipped">Skipped</option>
        </Select>
        <Select label="Channel" value={channel} onChange={(e) => (setChannel(e.target.value), setPage(1))}>
          <option value="">All</option>
          <option value="email">Email</option>
          <option value="whatsapp">WhatsApp</option>
        </Select>
      </FilterBar>
      <Panel padded={false}>
        {isError ? (
          <ErrorState message="Could not load notifications." onRetry={() => refetch()} />
        ) : isLoading ? (
          <Skeleton className="m-5 h-12" />
        ) : !data?.items.length ? (
          <EmptyState title="No notifications yet" />
        ) : (
          <Table>
            <thead>
              <tr>
                <th>When</th>
                <th>Event</th>
                <th>Channel</th>
                <th>Recipient</th>
                <th>Order</th>
                <th>Outcome</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((n) => (
                <tr key={n.id}>
                  <td className="whitespace-nowrap text-ink-soft">{formatDateTime(n.createdAt)}</td>
                  <td className="capitalize">{n.event.replace(/_/g, ' ')}</td>
                  <td className="capitalize">{n.channel}</td>
                  <td className="max-w-[200px] truncate text-ink-soft">{n.recipient}</td>
                  <td>{n.orderId ? <Link to={`/admin/orders/${n.orderId}`} className="text-rose-700 hover:underline">{n.order}</Link> : '—'}</td>
                  <td>
                    <Badge tone={n.status === 'sent' ? 'success' : n.status === 'failed' ? 'danger' : 'neutral'}>{n.status}</Badge>
                    {n.reason && <p className="mt-0.5 text-xs text-muted">{n.reason.replace(/_/g, ' ')}</p>}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
      {data && <Pagination className="mt-6" page={data.meta.page} pages={data.meta.pages} onChange={setPage} />}
    </>
  );
}

interface Message {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  subject: string;
  message: string;
  status: 'new' | 'read' | 'resolved';
  createdAt: string;
}

export function Messages() {
  useDocumentTitle('Messages');
  const qc = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin', 'messages', status, page],
    queryFn: () => api.get<{ items: Message[]; meta: PageMeta & { unread: number } }>('/admin/messages', { status, page, limit: 20 }),
    placeholderData: keepPreviousData,
  });
  const update = useMutation({
    mutationFn: ({ id, s }: { id: string; s: Message['status'] }) => api.patch(`/admin/messages/${id}`, { status: s }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'messages'] }),
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  return (
    <>
      <PageHeader title="Messages" description={data ? `${data.meta.unread} new` : 'Contact form submissions'} />
      <FilterBar>
        <Select label="Status" value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))}>
          <option value="">All</option>
          <option value="new">New</option>
          <option value="read">Read</option>
          <option value="resolved">Resolved</option>
        </Select>
      </FilterBar>
      {isError ? (
        <ErrorState message="Could not load messages." onRetry={() => refetch()} />
      ) : isLoading ? (
        <Skeleton className="h-24" />
      ) : !data?.items.length ? (
        <Panel>
          <EmptyState title="No messages" description="Messages from the Contact page appear here." />
        </Panel>
      ) : (
        <ul className="space-y-3">
          {data.items.map((m) => (
            <li key={m.id} className="rounded-2xl border border-line bg-paper p-5 shadow-soft">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{m.subject}</p>
                  <p className="text-xs text-muted">
                    {m.name} · <a href={`mailto:${m.email}`} className="text-rose-700 hover:underline">{m.email}</a>
                    {m.phone && ` · ${m.phone}`} · {formatDateTime(m.createdAt)}
                  </p>
                </div>
                <Badge tone={m.status === 'new' ? 'rose' : m.status === 'resolved' ? 'success' : 'neutral'}>{m.status}</Badge>
              </div>
              <p className="mt-3 whitespace-pre-wrap text-sm text-ink-soft">{m.message}</p>
              <div className="mt-3 flex gap-2">
                {m.status !== 'read' && (
                  <Button size="sm" variant="secondary" onClick={() => update.mutate({ id: m.id, s: 'read' })}>
                    Mark read
                  </Button>
                )}
                {m.status !== 'resolved' && (
                  <Button size="sm" variant="secondary" onClick={() => update.mutate({ id: m.id, s: 'resolved' })}>
                    Resolve
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {data && <Pagination className="mt-6" page={data.meta.page} pages={data.meta.pages} onChange={setPage} />}
    </>
  );
}
