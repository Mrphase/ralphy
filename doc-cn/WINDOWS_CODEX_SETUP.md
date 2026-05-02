# Ralphy Windows + Codex ָ��

��ָ���������� Windows ������λ�� `E:\Ecode\ralphy` ����¡�Ĳֿ⣬ͨ�� `Ralphy` ���ð�װ�� `codex` CLI��

## 1. ׼������

�� PowerShell ��ȷ����Щ������Թ�����

```powershell
git --version
node --version
npm --version
codex --version
codex exec --help
```

�Ƽ��汾��

- Node.js 18+
- npm 9+
- ���������� `codex` CLI ��¼״̬

��� `codex --version` ʧ�ܣ�����ʹ�� Ralphy ֮ǰ�Ȱ�װ���޸� Codex CLI��

## 2. ��¡�� `E:\Ecode`

```powershell
git clone https://github.com/michaelshimeles/ralphy.git E:\Ecode\ralphy
cd E:\Ecode\ralphy
```

## 3. ��װ CLI ����

�ڴӿ�¡�Ĳֿ����д���ʱ��Ralphy ��Դ����������Ҫ `cli` �����

```powershell
cd E:\Ecode\ralphy\cli
npm install --no-package-lock
cd E:\Ecode\ralphy
```

ע�⣺

- ���ڲֿ������ `cli\package-lock.json`�����Ըð�װ�����ڱ��ء�
- �״�Դ�����л��Զ����� `cli\src\version.ts`��
- ����������ѱ���� Windows �������ļ��������������˽���ʹ�� `tsx` �� `npx tsx`��

## 4. ��֤����������

PowerShell ��ڣ�

```powershell
cd E:\Ecode\ralphy
.\ralphy.ps1 --help
```

CMD ��ڣ�

```powershell
cd E:\Ecode\ralphy
cmd /c ralphy.cmd --help
```

�������һ�������ܴ�ӡ��������Ϣ����˵�����زֿ����������ڹ�����

## 5. ͨ�� Ralphy ��֤ Codex 

��������һ����ȫ�ĵ�������ԣ�

```powershell
cd E:\Ecode\ralphy
.\ralphy.ps1 --codex --no-tests --no-lint --no-commit "�Ķ� cli/package.json ����ֻ��ظ�������package name������Ҫ�޸��κ��ļ���"
```

Ԥ�ڽ����

- Ralphy ��������
- ������ʾΪ `Codex`
- ���񷵻�һ����̵��ı���
- ��Ϊ������ `--no-commit` ��־������û�д����κ��ύ

## 6. ��ʼ����Ŀ����

�⽫Ϊ���ֿⴴ�� `.ralphy\config.yaml`��

```powershell
cd E:\Ecode\ralphy
.\ralphy.ps1 --init
.\ralphy.ps1 --config
```

֮����������Ҫ���κ���Ŀ����

```powershell
.\ralphy.ps1 --add-rule "prefer small focused changes (ƫ��С��רע�ĸ���)"
.\ralphy.ps1 --add-rule "run tests before finishing (���ǰ���в���)"
```

�� `--init` ������֪ʶ�ļ���

- `.ralphy\config.yaml`
- `.ralphy\progress.txt`
- `.ralphy\progress.md`
- `.ralphy\AGENTS.md`

ʹ������������������ǣ�

```powershell
.\ralphy.ps1 knowledge show
```

���ã�

```powershell
.\ralphy.ps1 knowledge reset
```

## 7. ���� Codex ������ģʽ 

ʾ����

```powershell
cd E:\Ecode\ralphy
.\ralphy.ps1 --codex "�� README ������һ�� Windows �����ų��Ĳ���"
```

���õı�־ (flags) ��

- `--no-tests` ������������
- `--no-lint` ���������� (lint) ����
- `--no-commit` ��ֹ�Զ��ύ
- `--model <name>` ���Ǵ������ Codex ģ��
- `--` �������־ֱ�Ӵ��ݸ��·��� `codex` CLI

����ֱ���ʹ� Codex �����в�����ʾ����

```powershell
.\ralphy.ps1 --codex --model gpt-5.5 "总结仓库结构" -- --profile default
```

Ҫ�����һ����ʾ (prompt) ����ִ��ʵ������

```powershell
.\ralphy.ps1 --codex --dry-run --no-tests --no-lint "��Ҫ�����޸�"
```

��� `.ralphy\progress.md` ��������һ��ѧϰ��Ŀ�������У�dry-run����ʾ��Ӧ������

- `## Agent Instructions (����ָ��)`
- `## Recent Task Learnings (��������ѧϰ)`

## 8. ʹ�� Codex ���� PRD ģʽ

���ֿ��Ѿ������� [`example-prd.md`](./example-prd.md)��

```powershell
cd E:\Ecode\ralphy
.\ralphy.ps1 --codex --prd .\example-prd.md --no-commit
```

Ralphy ���᣺

1. �� PRD �ж�ȡ�����б�
2. ��ѡ��һ��δ��ɵ�����
3. �ڸ����������� Codex
4. ������ɵ���Ŀ���Ϊ done����ɣ�

## 9. ��� PowerShell ����ֹ����ʹ�� CMD ��װ��

���������� PowerShell ִ�в�����ֹ������ `.ps1` �ļ�����ʹ�ã�

```powershell
cd E:\Ecode\ralphy
cmd /c ralphy.cmd --help
cmd /c ralphy.cmd --codex "�ܽ�����ֿ�"
```

���������ġ�����ѧϰ��֪ʶ��������������� [KNOWLEDGE_TRANSFER_GUIDE.md](./KNOWLEDGE_TRANSFER_GUIDE.md)��

## 10. ���ѽ��

�Ҳ��� `node` ��

```powershell
node --version
```

��װ Node.js��Ȼ�����´��նˡ�

�Ҳ��� `codex` ��

```powershell
codex --version
```

�����޸� Codex CLI �İ�װ�� PATH ����������

`Binary not found: ... ralphy-windows-x64.exe` (�Ҳ����������ļ�)��

- �����һ���¿�¡�Ĳֿ���˵�������ġ�
- �� `npm install --no-package-lock` ֮��������Ӧ�û��Զ����˵�Դ��·����

���� `src/version.ts` �� `ERR_MODULE_NOT_FOUND`��

- �������� `.\ralphy.ps1 --help`
- ���������ڻ��ڵ�һ��Դ������ʱ�Զ����ɸ��ļ���

`git` ��ʾ `dubious ownership` (���ɵ�����Ȩ)��

```powershell
git config --global --add safe.directory E:/Ecode/ralphy
```

ֻ�е� Git ��ȷ��ʾ�òֿ���ڴ˾���ʱ������������