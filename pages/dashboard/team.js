import { useEffect, useState } from 'react';
import Layout from '../../components/Layout';
import Dropdown from '../../components/Dropdown';
import { getSessionFromReq } from '../../lib/auth';

function formatDate(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export async function getServerSideProps({ req }) {
  const session = getSessionFromReq(req);
  if (!session) {
    return { redirect: { destination: '/login', permanent: false } };
  }
  if (session.role !== 'admin') {
    return { redirect: { destination: '/dashboard', permanent: false } };
  }
  return { props: { session } };
}

export default function Team({ session }) {
  const [users, setUsers] = useState([]);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('member');
  const [status, setStatus] = useState(null);

  async function loadUsers() {
    const res = await fetch('/api/users');
    const data = await res.json();
    if (res.ok) setUsers(data);
  }

  useEffect(() => {
    loadUsers();
  }, []);

  async function handleInvite(e) {
    e.preventDefault();
    setStatus(null);
    const res = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, role }),
    });
    const data = await res.json();
    if (!res.ok) {
      setStatus({ type: 'error', message: data.error });
      return;
    }
    setStatus({ type: 'success', message: `Added "${data.username}".` });
    setUsername('');
    setPassword('');
    setRole('member');
    loadUsers();
  }

  async function handleRoleChange(id, newRole) {
    await fetch(`/api/users/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: newRole }),
    });
    loadUsers();
  }

  async function handleRemove(id, name) {
    if (!confirm(`Remove ${name}'s access?`)) return;
    await fetch(`/api/users/${id}`, { method: 'DELETE' });
    loadUsers();
  }

  return (
    <Layout title="Team" session={session}>
      <div className="card">
        <h2>Add a team member</h2>
        <form onSubmit={handleInvite}>
          <div className="field">
            <label htmlFor="new-username">Username</label>
            <input
              id="new-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="new-password">Temporary password</label>
            <input
              id="new-password"
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              required
            />
            <p className="helper-text">At least 8 characters. Share it with them privately.</p>
          </div>
          <div className="field">
            <label htmlFor="new-role">Role</label>
            <Dropdown
              id="new-role"
              value={role}
              onChange={setRole}
              options={[
                { value: 'member', label: 'Member — can view and upload videos' },
                { value: 'admin', label: 'Admin — can also manage the team' },
              ]}
            />
          </div>
          {status && (
            <div className={`banner ${status.type === 'error' ? 'banner-error' : 'banner-success'}`}>
              {status.message}
            </div>
          )}
          <button type="submit" className="btn btn-primary">
            Add member
          </button>
        </form>
      </div>

      <div className="card">
        <h2>Everyone with access</h2>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Username</th>
                <th>Role</th>
                <th>Added</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.username}</td>
                  <td>
                    <Dropdown
                      value={u.role}
                      onChange={(v) => handleRoleChange(u.id, v)}
                      options={[
                        { value: 'member', label: 'Member' },
                        { value: 'admin', label: 'Admin' },
                      ]}
                    />
                  </td>
                  <td className="mono">{formatDate(u.created_at)}</td>
                  <td>
                    <button className="btn btn-danger" onClick={() => handleRemove(u.id, u.username)}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Layout>
  );
}
