import initWs from "../initWs";

for (let i = 0; i < 50; i++) {
  setTimeout(() => initWs(), i * 500);
}
