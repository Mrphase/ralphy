# Ralphy WSL + Codex ָ��

��ָ���������� WSL �е� `/mnt/e/Ecode/ralphy` Ŀ¼�����п�¡�Ĳֿ⣬��ͨ�� Ralphy ���� WSL �ڲ���װ�� `codex` CLI��

## 1. ׼������

��һ�� WSL �ն� (shell) ����֤����������

```bash
uname -a
cat /etc/os-release | sed -n '1,6p'
command -v codex
codex --version
```

�Ƽ��Ļ���������

- WSL2
- Ubuntu
- �� WSL ����һ������������ `codex` CLI (�ѵ�¼)

��� `codex --version` ʧ�ܣ����ڼ���ʹ�� Ralphy ֮ǰ���� WSL ���޸� Codex CLI��

## 2. ���뱾�زֿ�

```bash
cd /mnt/e/Ecode/ralphy
pwd
```

Ԥ��·����

```text
/mnt/e/Ecode/ralphy
```

## 3. ��װ Linux Node.js ���޸� WSL Codex ��װ��

���вֿⱾ���ṩ�Ļ������ø����ű���

```bash
cd /mnt/e/Ecode/ralphy
./wsl_setup_codex.sh
```

�������ã�

- ��֤���Ƿ��� WSL �ڲ��� Ubuntu ��
- ͨ�� `apt` ��װ Linux ��� `nodejs` �� `npm`
- ��֤ `node` �� `npm` �Ƿ����Ϊ Linux ·�������������� `/mnt/c/...` ������ Windows ·��
- ��� WSL ��ȱ��������֤�ļ����ű��᳢�Ե��� Windows �Ǳߵ� Codex `file` ƾ�ݴ洢�ļ��� `~/.codex/` ��
- ��� `codex` ����
- ������� `~/.local/lib/codex-linux/codex-x86_64-unknown-linux-musl` �������ļ����ű�����д `~/.local/bin/codex` ��ʹ��ʹ��ԭ���� Linux �������ļ�

## 4. ��֤ Linux Node.js �� Codex

```bash
command -v node
node --version
command -v npm
npm --version
command -v codex
codex --version
```

Ԥ�ڽ����

- `node` ָ�� `/usr/bin/node`
- `npm` ָ�� `/usr/bin/npm`
- `codex` ������������

������� `~/.local/lib/codex-linux/codex-x86_64-unknown-linux-musl`����֤���װ������ָ�� Windows��Node��

```bash
sed -n '1,40p' ~/.local/bin/codex
```

��װ��Ӧ��ִ�� Linux ��ԭ���������ļ������� `/mnt/c/Program Files/nodejs/node.exe`��

## 5. ��װ Ralphy CLI ����

```bash
cd /mnt/e/Ecode/ralphy/cli
npm install --no-package-lock
cd /mnt/e/Ecode/ralphy
```

ע�⣺

- ���� `cli/package-lock.json` ����Ŀ���ԣ���Щ���������ִ����ڱ��ء�
- ��Դ���״�����ȱ�ٸ��ļ�ʱ�������ڱ������� `cli/src/version.ts`��
- WSL ���ؿ�¡ģʽʹ�� Node/TS CLI ·���������Ǵ�ͳ�� `ralphy.sh` �ű���

## 6. ��֤ WSL ������

ʹ�ñ���Ŀ����� WSL ׼���õİ�װ����

```bash
cd /mnt/e/Ecode/ralphy
./ralphy-wsl.sh --help
```

���������ӡ��������Ϣ����˵�����ص� WSL ���������ڹ�����

## 7. ͨ�� Ralphy ��֤ Codex

���ȣ�����һ����ȫ��ð�̲��ԣ�smoke test����

```bash
cd /mnt/e/Ecode/ralphy
./ralphy-wsl.sh --codex --no-tests --no-lint --no-commit "��ֱ�ӻظ� OK����Ҫʹ���κι��ߡ���Ҫ�޸��κ��ļ���"
```

Ԥ�ڽ����

- Ralphy ��������
- �������ʹ���� `Codex`
- ���ջ�õĻظ��� `OK`

## 8. ��ʼ����Ŀ����

```bash
cd /mnt/e/Ecode/ralphy
./ralphy-wsl.sh --init
./ralphy-wsl.sh --config
```

�����Ҫ������Ը���Ŀ����ȫ�ֹ���

```bash
./ralphy-wsl.sh --add-rule "prefer small focused changes (ƫ��С��רע�ĸ���)"
./ralphy-wsl.sh --add-rule "run tests before finishing (���ǰ��һ�����)"
```

�� `--init` �Զ���������֪ʶ�ļ��У�

- `.ralphy/config.yaml`
- `.ralphy/progress.txt`
- `.ralphy/progress.md`
- `.ralphy/AGENTS.md`

�ô�����ɲ鿴���ǵ����ݣ�

```bash
./ralphy-wsl.sh knowledge show
```

Ҫ�������õ������ԣ�

```bash
./ralphy-wsl.sh knowledge reset
```

## 9. ���е�����ģʽ 

```bash
cd /mnt/e/Ecode/ralphy
./ralphy-wsl.sh --codex "����һ����� WSL �����ų��� README ���ܽ�"
```

���õı�־ (flags) ��

- `--no-tests` �������в���
- `--no-lint` �������д���У��
- `--no-commit` ���ò����ύ (commit)
- `--model <name>`
- `--` ����֮��ı�־/����ֱ��͸���� Codex CLI

ʾ����

```bash
./ralphy-wsl.sh --codex --model gpt-5.5 "总结仓库结构" -- --profile default
```

����Ҫ��Ԥ�쿴��Ҫ���͸� AI ʲô������ʾ��(prompt)��������ʵ��ִ�и�����

```bash
./ralphy-wsl.sh --codex --dry-run --no-tests --no-lint "��Ҫ�޸��κ�����"
```

������ `.ralphy/progress.md` �����������һ��֪ʶѧϰ�����ݣ����ĸ����� (dry-run) ��ʾ��������ܿ��������ˣ�

- `## Agent Instructions (����ָ��)`
- `## Recent Task Learnings (��������ѧϰ)`

## 10. ���� PRD ģʽ

ʹ��Ŀ¼���ֳɾ��е� PRD ʾ��ģ�棺

```bash
cd /mnt/e/Ecode/ralphy
./ralphy-wsl.sh --codex --prd ./example-prd.md --no-commit
```

## 11. Ϊʲô WSL Ҫʹ�� `ralphy-wsl.sh` �ű�

��Ȼ�ֿ�����Ȼ�� `ralphy.sh` ����ű������� WSL �����𲽵�ָ����֮���Խ������� `ralphy-wsl.sh` �����ڣ�

- ����ֱ�ӻ��𱻳���ά�����µ��Ǹ� Node/TS CLI ����ڵ�
- ������һֱ�� npm ���ķ���·�����ֶ���ͬ��
- ����ű��ڴ�ǰ���Ѷ����Ӧ������Щ�����ר��Ϊ�޲� Windows �����Զ������� `cli/bin.js` �еĲ�������

��ͳ�� `ralphy.sh` ȷʵ���ɻ������ã����������� WSL ���ؿ�¡�����Ͻ�������������ѡ·����

## 12. �������ϴ���

`node` ��Ȼָ�� `/mnt/c/`��

```bash
command -v node
command -v npm
```

��Ҫȥ������һ�飺

```bash
cd /mnt/e/Ecode/ralphy
./wsl_setup_codex.sh
```

Ȼ���ٴ�һ��ȫ�¸ɾ����ն˴�����ȥ���һ�¡�

`codex` ����ָ�� Windows �� Node��

```bash
sed -n '1,40p' ~/.local/bin/codex
```

����Ƿ��� Linux �����Ǹ�ԭ�� Codex �Ŀ�ִ�ж������ļ��ڴ��ڵ��������������һ�� `./wsl_setup_codex.sh`��

ִ��ԭ���� Linux �� Codex ʱ���� `401 Unauthorized` ��������ʾ��ȱ����Ȩ��δ��֤����

- ��ȥ��һ�� `./wsl_setup_codex.sh` ��ϵͳ������ Windows ��ѻ����ļ��洢��file-store����֤�õ����������ļ�ץ���ϲ�������
- ��ɴ�ֱ���� WSL ����һ�� `codex login` ���н����¼���ɡ�

��� WSL �������������ôһ�䣺

```text
wsl: A localhost proxy configuration was detected but not mirrored into WSL
```

����������ʵ���ʡ�ģ����������Ϊ WSL ��� NAT �����������Ϊ���ò����ġ���������˵������ Ralphy ��˳��˹��ϻ����ˡ��������ָ�ϱ���Ҳ��ȥ������Ӳ���̶���ַ������������ʹ�õ�����һ��һ����Ҫ���ɴ��ߴ�������͸�������õĻ����С�

��������� Codex ��ͬ����ĳЩ�������־�������� `403 Forbidden` ���־�����Ϣ�Ļ���

- ���ֱ�������ȷ���ڿ������ϸ�У���ʱ��ͱ�����͹۲쵽�ˡ�
- ����ʵ���ⲻ��ô��ȥ���ŷ�����ֱ��˳��������ִ�е����й� `codex exec` ��ʹ�ú�������������Ĳ�����
- ֻҪ��������������ǲ���ô����ȥ������Ҫ��ɵ�����ͷ�����ôƽ�������Ӻ�Ϊ����Щ�����������������龯����Կ����ɡ�

�����ʾ `./ralphy-wsl.sh` ˵�Ҳ�����ȱʧ��Ҫ�� Node.js �Ļ���

- ������������� WSL �������ԭ�� Linux �� Node.js �Ļ�����û�С�
- �������������ȵ�ȥ��ͨ�� `./wsl_setup_codex.sh` �����ʼ���̲��С�

����һ��������ƫ��������ѧϰ�����ͽ��еĹ���֪ʶ����ת�Ƶ�ʵʩ˵��������ϰ�̵̳Ļ��������������������ص�����ļ������н�����ϸ���ˣ�[KNOWLEDGE_TRANSFER_GUIDE.md](./KNOWLEDGE_TRANSFER_GUIDE.md)��