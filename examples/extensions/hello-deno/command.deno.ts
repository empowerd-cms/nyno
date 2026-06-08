export async function hello_deno(args: unknown[], context: Record<string, unknown>) {
  const name = args[0] ?? "World";
  context.custom_deno_var = `Hello, ${name} from Deno`;
  return 0;
}
