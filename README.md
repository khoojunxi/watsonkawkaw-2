# EV Charger AI

This is a Next.js project for the EV charger AI prototype.

## For Teammates: Open The Project In VS Code

Follow these steps slowly. You only need to do the setup once.

### 1. Install The Apps

Install these two apps first:

1. Visual Studio Code: https://code.visualstudio.com/
2. Node.js LTS: https://nodejs.org/

After installing Node.js, restart your computer if the terminal cannot find `npm`.

### 2. Download The Project From GitHub

Recommended easy method:

1. Open the GitHub repo link.
2. Click the green `Code` button.
3. Click `Download ZIP`.
4. Extract the ZIP file.
5. Open VS Code.
6. In VS Code, click `File` > `Open Folder`.
7. Select the extracted `ev-charger-ai` folder.
8. If VS Code asks whether you trust the folder, click `Yes, I trust the authors`.

Alternative method if you know Git:

```bash
git clone YOUR_GITHUB_REPO_LINK_HERE
cd ev-charger-ai
code .
```

### 3. Install The Project Packages

Inside VS Code:

1. Click `Terminal` > `New Terminal`.
2. Run this command:

```bash
npm install
```

Wait until it finishes.

### 4. Add The API Key

The app needs an OpenAI API key to use the AI features.

1. In the project folder, copy `.env.example`.
2. Rename the copy to `.env.local`.
3. Open `.env.local`.
4. Replace the placeholder value:

```bash
OPENAI_API_KEY=replace_with_your_openai_api_key
```

with the real key:

```bash
OPENAI_API_KEY=paste_the_real_key_here
```

Do not upload `.env.local` to GitHub.

### 5. Start The App

Run this command in the VS Code terminal:

```bash
npm run dev
```

Then open this link in a browser:

```text
http://localhost:3000
```

### 6. If Something Goes Wrong

If `npm` is not recognized, install Node.js LTS again and restart VS Code.

If the AI features do not work, check that `.env.local` exists and contains `OPENAI_API_KEY`.

If port `3000` is already being used, the terminal may show another link such as `http://localhost:3001`. Open the link shown in the terminal.

## For Project Owner: Upload To GitHub

Only the owner needs to do this.

### 1. Create A GitHub Repo

1. Go to https://github.com/
2. Click `+` > `New repository`.
3. Repository name: `ev-charger-ai`
4. Choose `Public` or `Private`.
5. Do not add README, `.gitignore`, or license on GitHub because this project already has them locally.
6. Click `Create repository`.

### 2. Push This Local Project

In the VS Code terminal, run:

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin YOUR_GITHUB_REPO_LINK_HERE
git push -u origin main
```

Replace `YOUR_GITHUB_REPO_LINK_HERE` with the repo link from GitHub, for example:

```text
https://github.com/your-username/ev-charger-ai.git
```

If the repo is private, invite teammates from GitHub repo `Settings` > `Collaborators`.
