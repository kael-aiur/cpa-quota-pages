export {};

const app = document.querySelector<HTMLDivElement>('#app');

if (!app) {
  throw new Error('Missing #app mount point');
}

const message = document.createElement('p');
message.textContent = 'user';
app.append(message);
