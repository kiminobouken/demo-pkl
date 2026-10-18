const roles = {
  siswa: {
    label: "NIS (Nomor Induk Siswa)",
    value: "202312047",
    button: "Masuk sebagai Siswa",
    page: "index.html",
  },
  guru: {
    label: "NIP / NUPTK",
    value: "198507122010012003",
    button: "Masuk sebagai Guru",
    page: "guru.html",
  },
  admin: {
    label: "Username admin",
    value: "admin.sekolah",
    button: "Masuk sebagai Admin",
    page: "admin.html",
  },
};
let selectedRole = "siswa";

document.querySelectorAll("#roleSwitch button").forEach((button) =>
  button.addEventListener("click", () => {
    selectedRole = button.dataset.role;
    const role = roles[selectedRole];
    document
      .querySelectorAll("#roleSwitch button")
      .forEach((item) => item.classList.toggle("active", item === button));
    document.querySelector("#idLabel").textContent = role.label;
    document.querySelector("#idInput").value = role.value;
    document.querySelector("#loginBtn").textContent = role.button;
  }),
);

document.querySelector("#loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const response = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: document.querySelector("#idInput").value.trim(),
      password: document.querySelector("#pwInput").value,
    }),
  });
  const result = await response.json();
  if (!response.ok) {
    const message = document.createElement("p");
    message.className = "login-error";
    message.textContent = result.message || "Login gagal.";
    document.querySelector("#loginForm").append(message);
    return;
  }
  if (result.user.role !== selectedRole) {
    await fetch("/api/logout", { method: "POST" });
    const message = document.createElement("p");
    message.className = "login-error";
    message.textContent = "Peran yang dipilih tidak sesuai dengan akun.";
    document.querySelector("#loginForm").append(message);
    return;
  }
  window.location.href = roles[result.user.role].page;
});
