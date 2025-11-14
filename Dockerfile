FROM node:24-alpine

LABEL "com.github.actions.name"="Create an issue"
LABEL "com.github.actions.description"="Creates a new issue using a template with front matter."
LABEL "com.github.actions.icon"="alert-circle"
LABEL "com.github.actions.color"="gray-dark"

LABEL "repository"="https://github.com/dblock/create-a-github-issue"
LABEL "homepage"="https://github.com/dblock/create-a-github-issue"
LABEL "maintainer"="Daniel Doubrovkine <dblock@dblock.org>"

COPY package*.json ./
RUN npm ci
COPY . .

ENTRYPOINT ["node", "/index.js"]
