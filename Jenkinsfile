pipeline {
    agent any
    stages {
        stage("Checkout") {
            steps {
                checkout scm
            }
        }
        stage("Deploy to Hostinger") {
            steps {
                sshagent(credentials: ["dms-hostinger-deploy-key"]) {
                    withCredentials([file(credentialsId: "dms-backend-env-production", variable: "ENV_FILE")]) {
                        sh """
                            scp -o StrictHostKeyChecking=no \$ENV_FILE dms-deploy@187.124.99.1:/home/dms-deploy/DMS-BACKEND/Backend/.env
                            ssh -o StrictHostKeyChecking=no dms-deploy@187.124.99.1 "
                                cd /home/dms-deploy/DMS-BACKEND &&
                                git pull origin main &&
                                cd Backend &&
                                docker compose up -d --build
                            "
                        """
                    }
                }
            }
        }
        stage("Verify") {
            steps {
                sshagent(credentials: ["dms-hostinger-deploy-key"]) {
                    sh """
                        sleep 15
                        ssh -o StrictHostKeyChecking=no dms-deploy@187.124.99.1 "
                            curl -s -o /dev/null -w \\"Gateway: %{http_code}\\n\\" http://127.0.0.1:9107
                        "
                    """
                }
            }
        }
    }
}
