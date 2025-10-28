import * as webllm from "https://esm.run/@mlc-ai/web-llm";

const chat = await webllm.createMLCEngine("Llama-3-8B-Instruct-q4f16_1");

document.getElementById("go").onclick = async () => {
  const prompt = document.getElementById("prompt").value;
  document.getElementById("out").textContent = "Loading...";
  const reply = await chat.chat.completions.create({
    messages: [{ role: "user", content: prompt }],
  });
  document.getElementById("out").textContent =
    reply.choices[0].message.content;
};
