import { Link } from '@inertiajs/react';

export default function UsersIndex({ users }: { users?: { id: number; name: string; email: string }[] }) {
  return (
    <div style={{ padding: '2rem' }}>
      <h1>Users</h1>
      {users && users.length > 0 ? (
        <ul>
          {users.map((user) => (
            <li key={user.id}>
              <Link href={`/users/${user.id}`}>{user.name}</Link> - {user.email}
            </li>
          ))}
        </ul>
      ) : (
        <p>Loading users...</p>
      )}
      <nav>
        <Link href="/">Home</Link> | <Link href="/about">About</Link>
      </nav>
    </div>
  );
}
