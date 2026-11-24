pipeline {
    agent any

    stages {

        stage('Build Backend') {
            steps {
                bat 'docker build -t sharing-backend ./backend'
            }
        }

        stage('Build Frontend') {
            steps {
                bat 'docker build -t sharing-frontend ./frontend'
            }
        }

        stage('Deploy Backend') {
            steps {
                bat 'docker rm -f sharing-backend-container || exit /b 0'
                bat 'docker run -d -p 8000:8000 --name sharing-backend-container sharing-backend'
            }
        }

        stage('Deploy Frontend') {
            steps {
                bat 'docker rm -f sharing-frontend-container || exit /b 0'
                bat 'docker run -d -p 3000:80 --name sharing-frontend-container sharing-frontend'
            }
        }
    }
}